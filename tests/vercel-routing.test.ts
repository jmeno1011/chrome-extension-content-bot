import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel routing", () => {
  it("routes health and Slack events to the serverless API handler", () => {
    const config = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as {
      rewrites: { source: string; destination: string }[];
    };

    expect(config.rewrites).toContainEqual({ source: "/health", destination: "/api/health" });
    expect(config.rewrites).toContainEqual({
      source: "/api/slack/events",
      destination: "/api/slack/events",
    });
  });
});
