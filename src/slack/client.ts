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

  return {
    async postMessage(message) {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(message),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !body.ok) {
        throw new Error(`Slack postMessage failed: ${body.error ?? response.statusText}`);
      }
    },
  };
}
