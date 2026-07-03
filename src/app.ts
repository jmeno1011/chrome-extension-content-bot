import express, { type Request } from "express";
import { waitUntil } from "@vercel/functions";
import { loadConfig } from "./config.js";
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
  commandTimeoutMs?: number;
};

type DraftContext = {
  readme: string;
  draft: AiOutput;
};

export function createApp(dependencies: AppDependencies = {}) {
  const config = loadConfig();
  const commandTimeoutMs = dependencies.commandTimeoutMs ?? config.commandTimeoutMs;
  const draftContexts = new Map<string, DraftContext>();
  const slack = dependencies.slack ?? createSlackClient(config.slackBotToken);
  const generateDraft =
    dependencies.generateDraft ??
    (async (readme: string) => {
      if (!config.openaiApiKey) {
        throw new Error("OPENAI_API_KEY is required");
      }

      const [{ OpenAI }, { generateExtensionDraft }] = await Promise.all([
        import("openai"),
        import("./openai/generate-extension-draft.js"),
      ]);

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

      const { createExtensionPullRequest } = await import("./github/create-extension-pr.js");

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

    if (body.type !== "event_callback" || body.event?.type !== "app_mention") {
      response.json({ ok: true });
      return;
    }

    const command = parseMentionCommand(body.event.text ?? "");
    const threadTs = body.event.thread_ts ?? body.event.ts;
    console.log("[slack] command parsed", {
      command: command.name,
      hasArgument: command.argument.length > 0,
      threadTs,
    });

    const task = handleAppMention({
      command,
      request,
      threadTs,
      channel: body.event.channel,
      slack,
      draftContexts,
      generateDraft,
      createPullRequest,
      commandTimeoutMs,
    });

    if (process.env.VERCEL) {
      waitUntil(task);
      response.json({ ok: true });
      return;
    }

    await task;
    response.json({ ok: true });
  });

  return app;
}

async function handleAppMention(input: {
  command: { name: string; argument: string };
  request: RequestWithRawBody;
  threadTs: string;
  channel: string;
  slack: SlackClient;
  draftContexts: Map<string, DraftContext>;
  generateDraft: (readme: string) => Promise<AiOutput>;
  createPullRequest: (extension: Extension) => Promise<{ url: string }>;
  commandTimeoutMs: number;
}) {
  const {
    command,
    request,
    threadTs,
    channel,
    slack,
    draftContexts,
    generateDraft,
    createPullRequest,
    commandTimeoutMs,
  } = input;

  try {
    const text = await withTimeout(
      createCommandReply({
        command,
        request,
        threadTs,
        draftContexts,
        generateDraft,
        createPullRequest,
      }),
      commandTimeoutMs,
    );

    await slack.postMessage({
      channel,
      text,
      thread_ts: threadTs,
    });
    console.log("[slack] reply sent", {
      channel,
      thread_ts: threadTs,
    });
  } catch (error) {
    console.error("[slack] reply failed", error);
    await postFailureMessage({ slack, channel, threadTs, error });
  }
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
  request: RequestWithRawBody;
  threadTs: string;
  draftContexts: Map<string, DraftContext>;
  generateDraft: (readme: string) => Promise<AiOutput>;
  createPullRequest: (extension: Extension) => Promise<{ url: string }>;
}): Promise<string> {
  const { command, request, threadTs, draftContexts, generateDraft, createPullRequest } = input;

  if (command.name === "/h" || command.name === "help") {
    return createHelpReply();
  }

  if (command.name === "health" || command.name === "check_health") {
    return createHealthReply(request);
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

  return "Connection confirmed. Send a README and I will generate structured data.";
}

async function createGenerateReply(
  readme: string,
  generateDraft: (readme: string) => Promise<AiOutput>,
  onGenerated: (draft: AiOutput) => void,
): Promise<string> {
  if (!readme) {
    return [
      "Please include README content.",
      "",
      "Example:",
      "@bot generate",
      "# My Chrome Extension",
      "README content...",
    ].join("\n");
  }

  try {
    const draft = await generateDraft(readme);
    onGenerated(draft);
    return formatDraftPreview(draft);
  } catch (error) {
    console.error("[slack] generate failed", error);
    throw error;
  }
}

async function postFailureMessage(input: {
  slack: SlackClient;
  channel: string;
  threadTs: string;
  error: unknown;
}) {
  const { slack, channel, threadTs, error } = input;
  const message =
    error instanceof CommandTimeoutError
      ? `Command timed out after ${error.timeoutMs}ms. Please try again with a shorter README or retry later.`
      : `Command failed: ${getErrorMessage(error)}`;

  try {
    await slack.postMessage({
      channel,
      thread_ts: threadTs,
      text: message,
    });
    console.log("[slack] failure reply sent", { channel, thread_ts: threadTs });
  } catch (postError) {
    console.error("[slack] failure reply failed", postError);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new CommandTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

class CommandTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super("Command timed out");
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

function createHelpReply(): string {
  return [
    "Available commands",
    "",
    "`@bot generate` + README content: generate a structured JSON preview",
    "`@bot add_github https://github.com/owner/repo`: add a GitHub URL to the current thread draft",
    "`@bot add_chrome https://chromewebstore.google.com/detail/...`: add a Chrome Store URL to the current thread draft",
    "`@bot edit_github https://github.com/owner/repo`: overwrite the GitHub URL",
    "`@bot edit_chrome https://chromewebstore.google.com/detail/...`: overwrite the Chrome Store URL",
    "`@bot add_category Automation Tool`: add category when empty",
    "`@bot edit_category Productivity`: overwrite category",
    "`@bot preview`: show the current thread draft",
    "`@bot approve`: validate final schema and create a PR",
    "`@bot health`: show deployment health URL",
    "`@bot /h`: show commands",
    "",
    "Note: `add_github` and `add_chrome` only add values when the existing value is empty. Use `edit_*` to overwrite.",
  ].join("\n");
}

function createHealthReply(request: RequestWithRawBody): string {
  const healthUrl = `${getPublicOrigin(request)}/health`;

  return ["Health check OK", "", `Checked URL: ${healthUrl}`].join("\n");
}

function getPublicOrigin(request: RequestWithRawBody): string {
  const forwardedProto = firstHeaderValue(request.header("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.header("x-forwarded-host"));
  const protocol = forwardedProto ?? request.protocol ?? "https";
  const host = forwardedHost ?? request.header("host") ?? "localhost";

  return `${protocol}://${host}`;
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim();
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
    return "No draft exists in this thread. Run `@bot generate` with a README first.";
  }

  if (!url || !validator(url)) {
    return `${label} URL format is invalid. Check the value and try again.`;
  }

  const currentValue = context.draft.extension[field];
  if (currentValue && !overwrite) {
    return [`${label} already has a value.`, "", currentValue].join("\n");
  }

  context.draft = {
    ...context.draft,
    extension: {
      ...context.draft.extension,
      [field]: url,
    },
    missingFields: context.draft.missingFields.filter((missingField) => missingField !== field),
  };

  const action = currentValue ? "updated" : "added";
  return [`${label} value ${action}.`, "", formatDraftPreview(context.draft)].join("\n");
}

function createCategoryReply(input: {
  context: DraftContext | undefined;
  category: string;
  overwrite: boolean;
}): string {
  const { context, category, overwrite } = input;

  if (!context) {
    return "No draft exists in this thread. Run `@bot generate` with a README first.";
  }

  if (!category.trim()) {
    return "Please include a category value. Example: `@bot add_category Automation Tool`";
  }

  const currentValue = context.draft.extension.category;
  if (currentValue && !overwrite) {
    return ["category already has a value.", "", currentValue].join("\n");
  }

  context.draft = {
    ...context.draft,
    extension: {
      ...context.draft.extension,
      category: category.trim(),
    },
    missingFields: context.draft.missingFields.filter((missingField) => missingField !== "category"),
  };

  const action = currentValue ? "updated" : "added";
  return [`category value ${action}.`, "", formatDraftPreview(context.draft)].join("\n");
}

function createPreviewReply(context: DraftContext | undefined): string {
  if (!context) {
    return "No draft exists in this thread. Run `@bot generate` with a README first.";
  }

  return formatDraftPreview(context.draft);
}

async function createApproveReply(
  context: DraftContext | undefined,
  createPullRequest: (extension: Extension) => Promise<{ url: string }>,
): Promise<string> {
  if (!context) {
    return "No draft exists in this thread. Run `@bot generate` with a README first.";
  }

  const result = extensionSchema.safeParse(context.draft.extension);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `- ${path || "extension"}: ${issue.message}`;
    });

    return ["Cannot approve. Fix these fields first.", "", ...issues].join("\n");
  }

  try {
    const pullRequest = await createPullRequest(result.data);
    return [
      "Approval complete",
      "",
      "Created a GitHub PR.",
      pullRequest.url,
      "",
      formatDraftPreview(context.draft),
    ].join("\n");
  } catch (error) {
    console.error("[github] pull request creation failed", error);
    return `Approval passed, but GitHub PR creation failed: ${getErrorMessage(error)}`;
  }
}

function formatDraftPreview(draft: AiOutput): string {
  const missingFields =
    draft.missingFields.length > 0
      ? ["missingFields:", ...draft.missingFields.map((field) => `- ${field}`)].join("\n")
      : "missingFields: none";
  const questions =
    draft.questions.length > 0
      ? ["questions:", ...draft.questions.map((question) => `- ${question}`)].join("\n")
      : "questions: none";
  const json = JSON.stringify(draft, null, 2);

  return ["Structured data generated", "", missingFields, "", questions, "", "```", json, "```"].join(
    "\n",
  );
}

function isGithubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(url);
}

function isChromeStoreUrl(url: string): boolean {
  return /^https:\/\/chromewebstore\.google\.com\/detail\/[^\s]+$/.test(url);
}
