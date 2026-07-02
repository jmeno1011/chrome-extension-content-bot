import fs from "node:fs/promises";
import OpenAI from "openai";
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
        "OpenAI API quota가 부족해서 구조화 출력 확인을 진행할 수 없습니다.",
        "",
        "확인할 것:",
        "- OpenAI Platform billing/credits가 활성화되어 있는지",
        "- .env의 OPENAI_API_KEY가 quota가 있는 project의 key인지",
        "- ChatGPT Plus/Pro 구독과 OpenAI API credit은 별도인지",
        "",
        "quota를 해결한 뒤 같은 명령을 다시 실행하세요:",
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
