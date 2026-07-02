import { describe, expect, it } from "vitest";
import { generateExtensionDraft } from "../src/openai/generate-extension-draft.js";

describe("generateExtensionDraft", () => {
  it("parses and validates structured extension data from OpenAI", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            extension: {
              id: "sample-extension",
              name: "Sample Extension",
              slug: "sample-extension",
              category: "Productivity",
              status: "Draft",
              platform: "Chrome Extension",
              version: "1.0.0",
              language: "English",
              description: "A concise Chrome extension summary.",
              longDescription: "A longer Chrome extension description for the hub page.",
              github: "",
              chromeStore: "",
              privacyPath: "/extensions/sample-extension/privacy",
              privacyPolicy: {
                productName: "Sample Extension",
                lastUpdated: "2026-07-02",
                summary: "Sample Extension does not collect personal data.",
                contactEmail: "owner@example.com",
                sections: [
                  {
                    title: "1. Overview",
                    body: "Sample Extension runs locally in Chrome.",
                  },
                ],
                dataPractices: [
                  {
                    category: "personal",
                    title: "Personal data",
                    collects: false,
                    description: "No personal data is collected.",
                    sharedWithThirdParties: false,
                  },
                ],
                thirdPartiesDescription: "No third-party services receive user data.",
              },
            },
            missingFields: [],
            questions: [],
          }),
        }),
      },
    };

    const draft = await generateExtensionDraft({
      readme: "# Sample Extension\nA Chrome extension.",
      contactEmail: "owner@example.com",
      client,
    });

    expect(draft.extension.slug).toBe("sample-extension");
    expect(draft.extension.privacyPolicy.contactEmail).toBe("owner@example.com");
    expect(draft.missingFields).toEqual([]);
  });

  it("accepts JSON wrapped in a markdown code fence", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: [
            "```json",
            JSON.stringify({
              extension: {
                id: "fenced-extension",
                name: "Fenced Extension",
                slug: "fenced-extension",
                category: "Productivity",
                status: "Draft",
                platform: "Chrome Extension",
                version: "1.0.0",
                language: "English",
                description: "A concise Chrome extension summary.",
                longDescription: "A longer Chrome extension description for the hub page.",
                github: "",
                chromeStore: "",
                privacyPath: "/extensions/fenced-extension/privacy",
                privacyPolicy: {
                  productName: "Fenced Extension",
                  lastUpdated: "2026-07-02",
                  summary: "Fenced Extension does not collect personal data.",
                  contactEmail: "owner@example.com",
                  sections: [
                    {
                      title: "1. Overview",
                      body: "Fenced Extension runs locally in Chrome.",
                    },
                  ],
                  dataPractices: [
                    {
                      category: "personal",
                      title: "Personal data",
                      collects: false,
                      description: "No personal data is collected.",
                      sharedWithThirdParties: false,
                    },
                  ],
                  thirdPartiesDescription: "No third-party services receive user data.",
                },
              },
              missingFields: [],
              questions: [],
            }),
            "```",
          ].join("\n"),
        }),
      },
    };

    const draft = await generateExtensionDraft({
      readme: "# Fenced Extension\nA Chrome extension.",
      contactEmail: "owner@example.com",
      client,
    });

    expect(draft.extension.slug).toBe("fenced-extension");
  });

  it("accepts incomplete drafts when OpenAI reports missing fields", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            extension: {
              id: "",
              name: "Chrome Extension Content Bot",
              slug: "",
              category: "",
              status: "Draft",
              platform: "Chrome Extension",
              version: "1.0.0",
              language: "English",
              description: "A Slack automation server for Chrome Extensions Hub content intake.",
              longDescription:
                "Chrome Extension Content Bot receives README content and prepares structured metadata for Chrome Extensions Hub.",
              github: "",
              chromeStore: "",
              privacyPath: "",
              privacyPolicy: {
                productName: "Chrome Extension Content Bot",
                lastUpdated: "2026-07-02",
                summary: "This project README does not describe a published Chrome extension.",
                contactEmail: "owner@example.com",
                sections: [
                  {
                    title: "1. Overview",
                    body: "This is an automation server README, not a Chrome extension README.",
                  },
                ],
                dataPractices: [
                  {
                    category: "unknown",
                    title: "Data practices need review",
                    collects: false,
                    description: "The README does not provide enough extension data practice details.",
                    sharedWithThirdParties: false,
                  },
                ],
                thirdPartiesDescription: "Third-party use needs confirmation.",
              },
            },
            missingFields: ["id", "slug", "category", "privacyPath"],
            questions: ["What Chrome extension should this README describe?"],
          }),
        }),
      },
    };

    const draft = await generateExtensionDraft({
      readme: "# Chrome Extension Content Bot\nSlack automation server.",
      contactEmail: "owner@example.com",
      client,
    });

    expect(draft.extension.slug).toBe("");
    expect(draft.missingFields).toEqual(["id", "slug", "category", "privacyPath"]);
  });

  it("normalizes an invalid privacyPath from a valid slug", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            extension: {
              id: "path-fix-extension",
              name: "Path Fix Extension",
              slug: "path-fix-extension",
              category: "Productivity",
              status: "Draft",
              platform: "Chrome Extension",
              version: "1.0.0",
              language: "English",
              description: "A concise Chrome extension summary.",
              longDescription: "A longer Chrome extension description for the hub page.",
              github: "",
              chromeStore: "",
              privacyPath: "/privacy/path-fix-extension",
              privacyPolicy: {
                productName: "Path Fix Extension",
                lastUpdated: "2026-07-02",
                summary: "Path Fix Extension does not collect personal data.",
                contactEmail: "owner@example.com",
                sections: [
                  {
                    title: "1. Overview",
                    body: "Path Fix Extension runs locally in Chrome.",
                  },
                ],
                dataPractices: [
                  {
                    category: "personal",
                    title: "Personal data",
                    collects: false,
                    description: "No personal data is collected.",
                    sharedWithThirdParties: false,
                  },
                ],
                thirdPartiesDescription: "No third-party services receive user data.",
              },
            },
            missingFields: [],
            questions: [],
          }),
        }),
      },
    };

    const draft = await generateExtensionDraft({
      readme: "# Path Fix Extension\nA Chrome extension.",
      contactEmail: "owner@example.com",
      client,
    });

    expect(draft.extension.privacyPath).toBe("/extensions/path-fix-extension/privacy");
  });

  it("clears an invalid privacyPath when slug is missing", async () => {
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            extension: {
              id: "",
              name: "Missing Slug Extension",
              slug: "",
              category: "",
              status: "Draft",
              platform: "Chrome Extension",
              version: "1.0.0",
              language: "English",
              description: "A concise Chrome extension summary.",
              longDescription: "A longer Chrome extension description for the hub page.",
              github: "",
              chromeStore: "",
              privacyPath: "/privacy/missing-slug-extension",
              privacyPolicy: {
                productName: "Missing Slug Extension",
                lastUpdated: "2026-07-02",
                summary: "Missing Slug Extension does not collect personal data.",
                contactEmail: "owner@example.com",
                sections: [
                  {
                    title: "1. Overview",
                    body: "Missing Slug Extension runs locally in Chrome.",
                  },
                ],
                dataPractices: [
                  {
                    category: "personal",
                    title: "Personal data",
                    collects: false,
                    description: "No personal data is collected.",
                    sharedWithThirdParties: false,
                  },
                ],
                thirdPartiesDescription: "No third-party services receive user data.",
              },
            },
            missingFields: ["slug", "privacyPath"],
            questions: ["What slug should be used?"],
          }),
        }),
      },
    };

    const draft = await generateExtensionDraft({
      readme: "# Missing Slug Extension\nA Chrome extension.",
      contactEmail: "owner@example.com",
      client,
    });

    expect(draft.extension.privacyPath).toBe("");
  });
});
