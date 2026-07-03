import { describe, expect, it, vi } from "vitest";
import { createExtensionPullRequest } from "../src/github/create-extension-pr.js";
import type { Extension } from "../src/schema/extension.schema.js";

const extension: Extension = {
  id: "new-extension",
  name: "New Extension",
  slug: "new-extension",
  category: "Productivity",
  status: "Draft",
  platform: "Chrome Extension",
  version: "1.0.0",
  language: "English",
  description: "A short description.",
  longDescription: "A longer description.",
  github: "https://github.com/example/new-extension",
  chromeStore: "",
  privacyPath: "/extensions/new-extension/privacy",
  privacyPolicy: {
    productName: "New Extension",
    lastUpdated: "2026-07-02",
    summary: "No personal data is collected.",
    contactEmail: "owner@example.com",
    sections: [{ title: "1. Overview", body: "Runs locally." }],
    dataPractices: [
      {
        category: "personal",
        title: "Personal data",
        collects: false,
        description: "No personal data is collected.",
        sharedWithThirdParties: false,
      },
    ],
    thirdPartiesDescription: "No third-party sharing.",
  },
};

describe("createExtensionPullRequest", () => {
  it("creates a branch, updates extensions.json, and opens a pull request", async () => {
    const existingExtensions = [
      {
        ...extension,
        id: "existing-extension",
        name: "Existing Extension",
        slug: "existing-extension",
        privacyPath: "/extensions/existing-extension/privacy",
      },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ content: encodeBase64(JSON.stringify(existingExtensions)), sha: "file-sha" }))
      .mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/content/new-extension" }))
      .mockResolvedValueOnce(jsonResponse({ content: { path: "data/extensions.json" } }))
      .mockResolvedValueOnce(jsonResponse({ html_url: "https://github.com/example/extensions/pull/123" }));

    const result = await createExtensionPullRequest({
      extension,
      token: "ghp-token",
      owner: "example",
      repo: "extensions",
      baseBranch: "main",
      fetch,
      branchName: "content/new-extension",
    });

    expect(result.url).toBe("https://github.com/example/extensions/pull/123");
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/example/extensions/git/ref/heads/main");
    expect(fetch.mock.calls[2][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        ref: "refs/heads/content/new-extension",
        sha: "base-sha",
      }),
    });

    const updateBody = JSON.parse(String(fetch.mock.calls[3][1]?.body)) as {
      content: string;
      branch: string;
      sha: string;
    };
    const updatedExtensions = JSON.parse(decodeBase64(updateBody.content)) as Extension[];
    expect(updateBody.branch).toBe("content/new-extension");
    expect(updateBody.sha).toBe("file-sha");
    expect(updatedExtensions.map((item) => item.slug)).toEqual(["existing-extension", "new-extension"]);

    expect(fetch.mock.calls[4][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        title: "Add New Extension",
        head: "content/new-extension",
        base: "main",
        body: "Adds New Extension to Chrome Extensions Hub.",
      }),
    });
  });

  it("includes the GitHub target when base branch lookup fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          message: "Not Found",
          documentation_url: "https://docs.github.com/rest/git/refs#get-a-reference",
          status: "404",
        },
        404,
      ),
    );

    await expect(
      createExtensionPullRequest({
        extension,
        token: "ghp-token",
        owner: "jmeno1011",
        repo: "Doh-Chrome-Extensions-Hub",
        baseBranch: "main",
        fetch,
      }),
    ).rejects.toThrow(
      'GitHub API request failed while reading base branch "main" in jmeno1011/Doh-Chrome-Extensions-Hub',
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
