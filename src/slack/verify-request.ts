import crypto from "node:crypto";

export type SlackVerificationInput = {
  signingSecret: string | undefined;
  timestamp: string | string[] | undefined;
  signature: string | string[] | undefined;
  rawBody: string;
};

export function verifySlackRequest(input: SlackVerificationInput): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;

  if (!signingSecret || typeof timestamp !== "string" || typeof signature !== "string") {
    return false;
  }

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;

  return timingSafeEqual(signature, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}
