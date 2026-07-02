import { WebClient } from "@slack/web-api";

export type SlackPostMessage = {
  channel: string;
  text: string;
  thread_ts?: string;
};

export type SlackClient = {
  postMessage(message: SlackPostMessage): Promise<void>;
};

export function createSlackClient(token: string | undefined): SlackClient {
  if (!token) {
    return {
      async postMessage() {
        throw new Error("SLACK_BOT_TOKEN is required");
      },
    };
  }

  const client = new WebClient(token);

  return {
    async postMessage(message) {
      await client.chat.postMessage(message);
    },
  };
}
