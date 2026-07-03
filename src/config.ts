import "dotenv/config";

export type AppConfig = {
  port: number;
  commandTimeoutMs: number;
  slackBotToken?: string;
  slackSigningSecret?: string;
  openaiApiKey?: string;
  openaiModel: string;
  contactEmail: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubBaseBranch: string;
};

export function loadConfig(env = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    commandTimeoutMs: Number(env.COMMAND_TIMEOUT_MS ?? 8_000),
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    contactEmail: env.CONTACT_EMAIL ?? "owner@example.com",
    githubToken: env.GITHUB_TOKEN,
    githubOwner: env.GITHUB_OWNER,
    githubRepo: env.GITHUB_REPO,
    githubBaseBranch: env.GITHUB_BASE_BRANCH ?? "main",
  };
}
