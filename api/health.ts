type JsonResponse = {
  status(code: number): {
    json(body: unknown): void;
  };
};

export default function handler(_request: unknown, response: JsonResponse) {
  response.status(200).json({ ok: true });
}
