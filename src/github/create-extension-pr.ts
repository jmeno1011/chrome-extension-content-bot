import type { Extension } from "../schema/extension.schema.js";

type Fetch = typeof fetch;

export type CreateExtensionPullRequestInput = {
  extension: Extension;
  token: string;
  owner: string;
  repo: string;
  baseBranch: string;
  fetch?: Fetch;
  branchName?: string;
  autoMerge?: {
    enabled: boolean;
    mergeMethod: "MERGE" | "SQUASH" | "REBASE";
  };
};

export type CreateExtensionPullRequestResult = {
  url: string;
  autoMergeEnabled?: boolean;
};

export async function createExtensionPullRequest(
  input: CreateExtensionPullRequestInput,
): Promise<CreateExtensionPullRequestResult> {
  const fetchImpl = input.fetch ?? fetch;
  const branchName = input.branchName ?? createBranchName(input.extension.slug);
  const apiBase = `https://api.github.com/repos/${input.owner}/${input.repo}`;
  const repoFullName = `${input.owner}/${input.repo}`;

  const baseRef = await githubJson<{ object: { sha: string } }>(
    fetchImpl,
    `${apiBase}/git/ref/heads/${input.baseBranch}`,
    input.token,
    {
      action: `reading base branch "${input.baseBranch}" in ${repoFullName}`,
    },
  );
  const currentFile = await githubJson<{ content: string; sha: string }>(
    fetchImpl,
    `${apiBase}/contents/data/extensions.json?ref=${input.baseBranch}`,
    input.token,
    {
      action: `reading data/extensions.json from "${input.baseBranch}" in ${repoFullName}`,
    },
  );
  const extensions = JSON.parse(decodeBase64(currentFile.content)) as Extension[];

  if (extensions.some((extension) => extension.slug === input.extension.slug)) {
    throw new Error(`Extension slug already exists: ${input.extension.slug}`);
  }

  await githubJson(
    fetchImpl,
    `${apiBase}/git/refs`,
    input.token,
    {
      method: "POST",
      body: {
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      },
      action: `creating branch "${branchName}" in ${repoFullName}`,
    },
  );

  const updatedExtensions = [...extensions, input.extension];
  await githubJson(
    fetchImpl,
    `${apiBase}/contents/data/extensions.json`,
    input.token,
    {
      method: "PUT",
      body: {
        message: `Add ${input.extension.name}`,
        content: encodeBase64(`${JSON.stringify(updatedExtensions, null, 2)}\n`),
        sha: currentFile.sha,
        branch: branchName,
      },
      action: `updating data/extensions.json on "${branchName}" in ${repoFullName}`,
    },
  );

  const pullRequest = await githubJson<{ html_url: string; node_id: string }>(
    fetchImpl,
    `${apiBase}/pulls`,
    input.token,
    {
      method: "POST",
      body: {
        title: `Add ${input.extension.name}`,
        head: branchName,
        base: input.baseBranch,
        body: `Adds ${input.extension.name} to Chrome Extensions Hub.`,
      },
      action: `opening pull request from "${branchName}" to "${input.baseBranch}" in ${repoFullName}`,
    },
  );

  if (input.autoMerge?.enabled) {
    await enablePullRequestAutoMerge({
      fetchImpl,
      token: input.token,
      pullRequestId: pullRequest.node_id,
      mergeMethod: input.autoMerge.mergeMethod,
      repoFullName,
    });

    return { url: pullRequest.html_url, autoMergeEnabled: true };
  }

  return { url: pullRequest.html_url };
}

async function enablePullRequestAutoMerge(input: {
  fetchImpl: Fetch;
  token: string;
  pullRequestId: string;
  mergeMethod: "MERGE" | "SQUASH" | "REBASE";
  repoFullName: string;
}) {
  const query = `
    mutation EnablePullRequestAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: {
        pullRequestId: $pullRequestId,
        mergeMethod: $mergeMethod
      }) {
        pullRequest {
          autoMergeRequest {
            enabledAt
          }
        }
      }
    }
  `;

  const response = await input.fetchImpl("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      query,
      variables: {
        pullRequestId: input.pullRequestId,
        mergeMethod: input.mergeMethod,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub auto-merge setup failed while enabling auto-merge in ${input.repoFullName}: ${response.status} ${await response.text()}`,
    );
  }

  const result = (await response.json()) as { errors?: Array<{ message?: string }> };
  if (result.errors?.length) {
    const messages = result.errors.map((error) => error.message ?? "Unknown GraphQL error").join("; ");
    throw new Error(
      `GitHub auto-merge setup failed while enabling auto-merge in ${input.repoFullName}: ${messages}`,
    );
  }
}

async function githubJson<T = unknown>(
  fetchImpl: Fetch,
  url: string,
  token: string,
  options: { method?: string; body?: unknown; action?: string } = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const action = options.action ? ` while ${options.action}` : "";
    throw new Error(`GitHub API request failed${action}: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

function createBranchName(slug: string): string {
  return `content/add-${slug}-${Date.now()}`;
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}
