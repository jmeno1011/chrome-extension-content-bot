import express, { type Request } from "express";
import OpenAI from "openai";
import { loadConfig } from "./config.js";
import { createExtensionPullRequest } from "./github/create-extension-pr.js";
import { generateExtensionDraft } from "./openai/generate-extension-draft.js";
import type { AiOutput } from "./schema/ai-output.schema.js";
import { extensionSchema, type Extension } from "./schema/extension.schema.js";
import { createSlackClient, type SlackClient } from "./slack/client.js";
import { verifySlackRequest as verifySlackRequestDefault } from "./slack/verify-request.js";

type RequestWithRawBody = Request & {
  rawBody?: string;
};

type AppDependencies = {
  slack?: SlackClient;
  verifySlackRequest?: (request: RequestWithRawBody) => boolean;
  generateDraft?: (readme: string) => Promise<AiOutput>;
  createPullRequest?: (extension: Extension) => Promise<{ url: string }>;
};

type DraftContext = {
  readme: string;
  draft: AiOutput;
};

export function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const draftContexts = new Map<string, DraftContext>();
  const slack = dependencies.slack ?? createSlackClient(config.slackBotToken);
  const generateDraft =
    dependencies.generateDraft ??
    (async (readme: string) => {
      if (!config.openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required");
      }

      return generateExtensionDraft({
        readme,
        contactEmail: config.contactEmail,
        model: config.openaiModel,
        client: new OpenAI({ apiKey: config.openaiApiKey }),
      });
    });
  const createPullRequest =
    dependencies.createPullRequest ??
    (async (extension: Extension) => {
      if (!config.githubToken || !config.githubOwner || !config.githubRepo) {
        throw new Error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO are required");
      }

      return createExtensionPullRequest({
        extension,
        token: config.githubToken,
        owner: config.githubOwner,
        repo: config.githubRepo,
        baseBranch: config.githubBaseBranch,
      });
    });
  const verifySlackRequest =
    dependencies.verifySlackRequest ??
    ((request: RequestWithRawBody) =>
      verifySlackRequestDefault({
        signingSecret: config.slackSigningSecret,
        timestamp: request.header("x-slack-request-timestamp"),
        signature: request.header("x-slack-signature"),
        rawBody: request.rawBody ?? "",
      }));

  const app = express();

  app.use(
    express.json({
      verify: (request: RequestWithRawBody, _response, buffer) => {
        request.rawBody = buffer.toString("utf8");
      },
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/slack/events", async (request: RequestWithRawBody, response) => {
    if (!verifySlackRequest(request)) {
      console.warn("[slack] rejected request: invalid signature");
      response.status(401).json({ error: "invalid_slack_signature" });
      return;
    }

    const body = request.body;
    console.log("[slack] received", {
      type: body.type,
      eventType: body.event?.type,
      channel: body.event?.channel,
      user: body.event?.user,
    });

    if (body.type === "url_verification") {
      response.json({ challenge: body.challenge });
      return;
    }

    response.json({ ok: true });

    if (body.type !== "event_callback" || body.event?.type !== "app_mention") {
      return;
    }

    const command = parseMentionCommand(body.event.text ?? "");
    const threadTs = body.event.thread_ts ?? body.event.ts;

    try {
      const text = await createCommandReply({
        command,
        threadTs,
        draftContexts,
        generateDraft,
        createPullRequest,
      });

      await slack.postMessage({
        channel: body.event.channel,
        text,
        thread_ts: threadTs,
      });
      console.log("[slack] reply sent", {
        channel: body.event.channel,
        thread_ts: threadTs,
      });
    } catch (error) {
      console.error("[slack] reply failed", error);
    }
  });

  return app;
}

function parseMentionCommand(text: string): { name: string; argument: string } {
  const withoutMention = text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
  const match = withoutMention.match(/^(\S+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return { name: "", argument: "" };
  }

  return {
    name: match[1]?.toLowerCase() ?? "",
    argument: match[2]?.trim() ?? "",
  };
}

async function createCommandReply(input: {
  command: { name: string; argument: string };
  threadTs: string;
  draftContexts: Map<string, DraftContext>;
  generateDraft: (readme: string) => Promise<AiOutput>;
  createPullRequest: (extension: Extension) => Promise<{ url: string }>;
}): Promise<string> {
  const { command, threadTs, draftContexts, generateDraft, createPullRequest } = input;

  if (command.name === "/h" || command.name === "help") {
    return createHelpReply();
  }

  if (command.name === "generate") {
    return createGenerateReply(command.argument, generateDraft, (draft) => {
      draftContexts.set(threadTs, { readme: command.argument, draft });
    });
  }

  if (command.name === "add_github") {
    return createAddUrlReply({
      context: draftContexts.get(threadTs),
      field: "github",
      label: "github",
      url: command.argument,
      validator: isGithubUrl,
      overwrite: false,
    });
  }

  if (command.name === "add_chrome") {
    return createAddUrlReply({
      context: draftContexts.get(threadTs),
      field: "chromeStore",
      label: "chromeStore",
      url: command.argument,
      validator: isChromeStoreUrl,
      overwrite: false,
    });
  }

  if (command.name === "edit_github") {
    return createAddUrlReply({
      context: draftContexts.get(threadTs),
      field: "github",
      label: "github",
      url: command.argument,
      validator: isGithubUrl,
      overwrite: true,
    });
  }

  if (command.name === "edit_chrome") {
    return createAddUrlReply({
      context: draftContexts.get(threadTs),
      field: "chromeStore",
      label: "chromeStore",
      url: command.argument,
      validator: isChromeStoreUrl,
      overwrite: true,
    });
  }

  if (command.name === "add_category") {
    return createCategoryReply({
      context: draftContexts.get(threadTs),
      category: command.argument,
      overwrite: false,
    });
  }

  if (command.name === "edit_category") {
    return createCategoryReply({
      context: draftContexts.get(threadTs),
      category: command.argument,
      overwrite: true,
    });
  }

  if (command.name === "preview") {
    return createPreviewReply(draftContexts.get(threadTs));
  }

  if (command.name === "approve") {
    return createApproveReply(draftContexts.get(threadTs), createPullRequest);
  }

  return "연결 확인 완료: README를 보내주면 다음 단계에서 구조화 데이터를 만들게요.";
}

async function createGenerateReply(
  readme: string,
  generateDraft: (readme: string) => Promise<AiOutput>,
  onGenerated: (draft: AiOutput) => void,
): Promise<string> {
  if (!readme) {
    return [
      "README 내용을 같이 보내주세요.",
      "",
      "예:",
      "@bot generate",
      "# My Chrome Extension",
      "README 내용...",
    ].join("\n");
  }

  try {
    const draft = await generateDraft(readme);
    onGenerated(draft);
    return formatDraftPreview(draft);
  } catch (error) {
    console.error("[slack] generate failed", error);
    return "구조화 데이터 생성에 실패했습니다. 서버 로그를 확인해주세요.";
  }
}

function createHelpReply(): string {
  return [
    "사용 가능한 명령어",
    "",
    "`@bot generate` + README 내용: 구조화 JSON preview 생성",
    "`@bot add_github https://github.com/owner/repo`: 현재 thread draft에 GitHub URL 추가",
    "`@bot add_chrome https://chromewebstore.google.com/detail/...`: 현재 thread draft에 Chrome Store URL 추가",
    "`@bot edit_github https://github.com/owner/repo`: GitHub URL 덮어쓰기",
    "`@bot edit_chrome https://chromewebstore.google.com/detail/...`: Chrome Store URL 덮어쓰기",
    "`@bot add_category Automation Tool`: category가 비어 있을 때 추가",
    "`@bot edit_category Productivity`: category 덮어쓰기",
    "`@bot preview`: 현재 thread draft 다시 보기",
    "`@bot approve`: 최종 schema 검증 후 승인",
    "`@bot /h`: 명령어 보기",
    "",
    "참고: `add_github`, `add_chrome`은 기존 값이 비어 있을 때만 추가합니다. 덮어쓰기는 `edit_*`를 사용합니다.",
  ].join("\n");
}

function createAddUrlReply(input: {
  context: DraftContext | undefined;
  field: "github" | "chromeStore";
  label: string;
  url: string;
  validator: (url: string) => boolean;
  overwrite: boolean;
}): string {
  const { context, field, label, url, validator, overwrite } = input;

  if (!context) {
    return "현재 thread에 draft가 없습니다. 먼저 `@bot generate`로 README를 처리해주세요.";
  }

  if (!url || !validator(url)) {
    return `${label} URL 형식이 올바르지 않습니다. 값을 확인해서 다시 보내주세요.`;
  }

  const currentValue = context.draft.extension[field];
  if (currentValue && !overwrite) {
    return [`이미 ${label} 값이 있습니다.`, "", currentValue].join("\n");
  }

  context.draft = {
    ...context.draft,
    extension: {
      ...context.draft.extension,
      [field]: url,
    },
    missingFields: context.draft.missingFields.filter((missingField) => missingField !== field),
  };

  const action = currentValue ? "수정했습니다" : "추가했습니다";
  return [`${label} 값을 ${action}.`, "", formatDraftPreview(context.draft)].join("\n");
}

function createCategoryReply(input: {
  context: DraftContext | undefined;
  category: string;
  overwrite: boolean;
}): string {
  const { context, category, overwrite } = input;

  if (!context) {
    return "현재 thread에 draft가 없습니다. 먼저 `@bot generate`로 README를 처리해주세요.";
  }

  if (!category.trim()) {
    return "category 값을 같이 보내주세요. 예: `@bot add_category Automation Tool`";
  }

  const currentValue = context.draft.extension.category;
  if (currentValue && !overwrite) {
    return [`이미 category 값이 있습니다.`, "", currentValue].join("\n");
  }

  context.draft = {
    ...context.draft,
    extension: {
      ...context.draft.extension,
      category: category.trim(),
    },
    missingFields: context.draft.missingFields.filter((missingField) => missingField !== "category"),
  };

  const action = currentValue ? "수정했습니다" : "추가했습니다";
  return [`category 값을 ${action}.`, "", formatDraftPreview(context.draft)].join("\n");
}

function createPreviewReply(context: DraftContext | undefined): string {
  if (!context) {
    return "현재 thread에 draft가 없습니다. 먼저 `@bot generate`로 README를 처리해주세요.";
  }

  return formatDraftPreview(context.draft);
}

async function createApproveReply(
  context: DraftContext | undefined,
  createPullRequest: (extension: Extension) => Promise<{ url: string }>,
): Promise<string> {
  if (!context) {
    return "현재 thread에 draft가 없습니다. 먼저 `@bot generate`로 README를 처리해주세요.";
  }

  const result = extensionSchema.safeParse(context.draft.extension);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `- ${path || "extension"}: ${issue.message}`;
    });

    return ["승인할 수 없습니다. 아래 필드를 먼저 보완해주세요.", "", ...issues].join("\n");
  }

  try {
    const pullRequest = await createPullRequest(result.data);
    return [
      "승인 완료",
      "",
      "GitHub PR을 생성했습니다.",
      pullRequest.url,
      "",
      formatDraftPreview(context.draft),
    ].join("\n");
  } catch (error) {
    console.error("[github] pull request creation failed", error);
    return "승인은 통과했지만 GitHub PR 생성에 실패했습니다. 서버 로그와 GitHub 환경변수를 확인해주세요.";
  }
}

function formatDraftPreview(draft: AiOutput): string {
  const missingFields =
    draft.missingFields.length > 0
      ? ["missingFields:", ...draft.missingFields.map((field) => `- ${field}`)].join("\n")
      : "missingFields: 없음";
  const questions =
    draft.questions.length > 0
      ? ["questions:", ...draft.questions.map((question) => `- ${question}`)].join("\n")
      : "questions: 없음";
  const json = JSON.stringify(draft, null, 2);

  return ["구조화 데이터 생성 완료", "", missingFields, "", questions, "", "```", json, "```"].join(
    "\n",
  );
}

function isGithubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(url);
}

function isChromeStoreUrl(url: string): boolean {
  return /^https:\/\/chromewebstore\.google\.com\/detail\/[^\s]+$/.test(url);
}
