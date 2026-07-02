import { createApp } from "../../src/app.js";

const app = createApp();

type VercelLikeRequest = Parameters<typeof app>[0];
type VercelLikeResponse = Parameters<typeof app>[1];

export default function handler(request: VercelLikeRequest, response: VercelLikeResponse) {
  return app(request, response);
}
