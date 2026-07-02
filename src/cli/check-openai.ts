import fs from "node:fs/promises";
import { OpenAI } from "openai";
import { loadConfig } from "../config.js";
import { generateExtensionDraft } from "../openai/generate-extension-draft.js";

const readmePath = process.argv[2];

if (!readmePath) {
  console.error("Usage: npm run check:openai -- /path/to/README.md");
  process.exit(1);
}

const config = loadConfig();

if (!config.openaiApiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

try {
  const readme = await fs.readFile(readmePath, "utf8");
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const draft = await generateExtensionDraft({
    readme,
    contactEmail: config.contactEmail,
    model: config.openaiModel,
    client,
  });

  console.log(JSON.stringify(draft, null, 2));
} catch (error) {
  if (isOpenAIQuotaError(error)) {
    console.error(
      [
        "OpenAI API quota is insufficient, so the structured output check cannot continue.",
        "",
        "Check these items:",
        "- OpenAI Platform billing/credits are active",
        "- .env OPENAI_API_KEY belongs to a project with quota",
        "- ChatGPT Plus/Pro and OpenAI API credits are separate",
        "",
        "After fixing quota, run the same command again:",
        `npm run check:openai -- ${readmePath}`,
      ].join("\n"),
    );
    process.exit(1);
  }

  throw error;
}

function isOpenAIQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    code?: unknown;
    type?: unknown;
    error?: { code?: unknown; type?: unknown };
  };

  return (
    candidate.status === 429 &&
    (candidate.code === "insufficient_quota" ||
      candidate.type === "insufficient_quota" ||
      candidate.error?.code === "insufficient_quota" ||
      candidate.error?.type === "insufficient_quota")
  );
}
