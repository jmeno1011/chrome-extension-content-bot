import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("Slack events endpoint", () => {
  const baseDraft = {
    extension: {
      id: "my-extension",
      name: "My Extension",
      slug: "my-extension",
      category: "Productivity",
      status: "Draft",
      platform: "Chrome Extension",
      version: "1.0.0",
      language: "English",
      description: "A short description.",
      longDescription: "A longer description.",
      github: "",
      chromeStore: "",
      privacyPath: "/extensions/my-extension/privacy",
      privacyPolicy: {
        productName: "My Extension",
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
    },
    missingFields: ["chromeStore"],
    questions: ["Chrome Web Store URL이 있나요?"],
  };

  it("starts without Slack credentials for health checks", async () => {
    const app = createApp({
      verifySlackRequest: () => true,
    });

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("responds to Slack URL verification challenges", async () => {
    const app = createApp({
      slack: { postMessage: vi.fn() },
      verifySlackRequest: () => true,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({ type: "url_verification", challenge: "challenge-token" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ challenge: "challenge-token" });
  });

  it("acknowledges app mentions and sends a reply to the channel", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> ping",
          ts: "1710000000.000100",
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      text: "연결 확인 완료: README를 보내주면 다음 단계에서 구조화 데이터를 만들게요.",
      thread_ts: "1710000000.000100",
    });
  });

  it("generates a structured JSON preview from a generate command", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue(baseDraft);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000200",
        },
      });

    expect(response.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledWith("# My Extension\nREADME body");
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000200",
      text: expect.stringContaining("구조화 데이터 생성 완료"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain("```");
    expect(postMessage.mock.calls[0][0].text).toContain("\"slug\": \"my-extension\"");
    expect(postMessage.mock.calls[0][0].text).toContain("missingFields");
    expect(postMessage.mock.calls[0][0].text).toContain("Chrome Web Store URL이 있나요?");
  });

  it("shows command help with /h", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> /h",
          ts: "1710000000.000250",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000250",
      text: expect.stringContaining("add_github"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain("add_chrome");
    expect(postMessage.mock.calls[0][0].text).toContain("generate");
  });

  it("shows health check status and the checked URL", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .set("x-forwarded-proto", "https")
      .set("x-forwarded-host", "chrome-extension-content-bot.vercel.app")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> health",
          ts: "1710000000.000260",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000260",
      text: expect.stringContaining("Health check OK"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "https://chrome-extension-content-bot.vercel.app/health",
    );
  });

  it("adds github URL to the current thread draft when empty", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue(baseDraft);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000400",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> add_github https://github.com/example/my-extension",
          thread_ts: "1710000000.000400",
          ts: "1710000000.000401",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000400",
      text: expect.stringContaining("github 값을 추가했습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "\"github\": \"https://github.com/example/my-extension\"",
    );
  });

  it("does not overwrite an existing chromeStore URL", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({
      ...baseDraft,
      extension: {
        ...baseDraft.extension,
        chromeStore: "https://chromewebstore.google.com/detail/existing/abcdef",
      },
      missingFields: [],
      questions: [],
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000500",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> add_chrome https://chromewebstore.google.com/detail/new/xyz",
          thread_ts: "1710000000.000500",
          ts: "1710000000.000501",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000500",
      text: expect.stringContaining("이미 chromeStore 값이 있습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "https://chromewebstore.google.com/detail/existing/abcdef",
    );
  });

  it("edits an existing github URL", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({
      ...baseDraft,
      extension: {
        ...baseDraft.extension,
        github: "https://github.com/example/old-extension",
      },
      missingFields: [],
      questions: [],
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000600",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> edit_github https://github.com/example/new-extension",
          thread_ts: "1710000000.000600",
          ts: "1710000000.000601",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000600",
      text: expect.stringContaining("github 값을 수정했습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "\"github\": \"https://github.com/example/new-extension\"",
    );
    expect(postMessage.mock.calls[0][0].text).not.toContain("old-extension");
  });

  it("edits an existing chromeStore URL", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({
      ...baseDraft,
      extension: {
        ...baseDraft.extension,
        chromeStore: "https://chromewebstore.google.com/detail/existing/abcdef",
      },
      missingFields: [],
      questions: [],
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000700",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> edit_chrome https://chromewebstore.google.com/detail/new/xyz",
          thread_ts: "1710000000.000700",
          ts: "1710000000.000701",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000700",
      text: expect.stringContaining("chromeStore 값을 수정했습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "\"chromeStore\": \"https://chromewebstore.google.com/detail/new/xyz\"",
    );
    expect(postMessage.mock.calls[0][0].text).not.toContain("existing/abcdef");
  });

  it("adds category to the current thread draft when empty", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue({
      ...baseDraft,
      extension: {
        ...baseDraft.extension,
        category: "",
      },
      missingFields: ["category"],
      questions: [],
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000800",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> add_category Automation Tool",
          thread_ts: "1710000000.000800",
          ts: "1710000000.000801",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000800",
      text: expect.stringContaining("category 값을 추가했습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain("\"category\": \"Automation Tool\"");
    expect(postMessage.mock.calls[0][0].text).not.toContain("- category");
  });

  it("edits an existing category", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue(baseDraft);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.000900",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> edit_category Automation Tool",
          thread_ts: "1710000000.000900",
          ts: "1710000000.000901",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000900",
      text: expect.stringContaining("category 값을 수정했습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain("\"category\": \"Automation Tool\"");
    expect(postMessage.mock.calls[0][0].text).not.toContain("\"category\": \"Productivity\"");
  });

  it("previews the current thread draft", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue(baseDraft);
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.001000",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> preview",
          thread_ts: "1710000000.001000",
          ts: "1710000000.001001",
        },
      });

    expect(response.status).toBe(200);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.001000",
      text: expect.stringContaining("\"name\": \"My Extension\""),
    });
  });

  it("creates a GitHub PR when approving a draft that passes final extension validation", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn().mockResolvedValue(baseDraft);
    const createPullRequest = vi.fn().mockResolvedValue({
      url: "https://github.com/example/extensions/pull/123",
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
      createPullRequest,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.001100",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> approve",
          thread_ts: "1710000000.001100",
          ts: "1710000000.001101",
        },
      });

    expect(response.status).toBe(200);
    expect(createPullRequest).toHaveBeenCalledWith(baseDraft.extension);
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.001100",
      text: expect.stringContaining("승인 완료"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain(
      "https://github.com/example/extensions/pull/123",
    );
  });

  it("rejects approval when category is missing", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const createPullRequest = vi.fn();
    const generateDraft = vi.fn().mockResolvedValue({
      ...baseDraft,
      extension: {
        ...baseDraft.extension,
        category: "",
      },
      missingFields: ["category"],
      questions: [],
    });
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
      createPullRequest,
    });

    await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate\n# My Extension\nREADME body",
          ts: "1710000000.001200",
        },
      });
    postMessage.mockClear();

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> approve",
          thread_ts: "1710000000.001200",
          ts: "1710000000.001201",
        },
      });

    expect(response.status).toBe(200);
    expect(createPullRequest).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.001200",
      text: expect.stringContaining("승인할 수 없습니다"),
    });
    expect(postMessage.mock.calls[0][0].text).toContain("category");
  });

  it("asks for README content when generate command is empty", async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const generateDraft = vi.fn();
    const app = createApp({
      slack: { postMessage },
      verifySlackRequest: () => true,
      generateDraft,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C123",
          user: "U123",
          text: "<@BOT> generate",
          ts: "1710000000.000300",
        },
      });

    expect(response.status).toBe(200);
    expect(generateDraft).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "1710000000.000300",
      text: expect.stringContaining("@bot generate"),
    });
  });

  it("rejects requests that fail Slack signature verification", async () => {
    const app = createApp({
      slack: { postMessage: vi.fn() },
      verifySlackRequest: () => false,
    });

    const response = await request(app)
      .post("/api/slack/events")
      .send({ type: "event_callback", event: { type: "app_mention" } });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid_slack_signature" });
  });
});
