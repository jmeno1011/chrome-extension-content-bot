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
};

export type CreateExtensionPullRequestResult = {
  url: string;
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

  const pullRequest = await githubJson<{ html_url: string }>(
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

  return { url: pullRequest.html_url };
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
