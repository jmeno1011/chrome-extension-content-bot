type EmptyResponse = {
  status(code: number): {
    end(): void;
  };
};

export default function handler(_request: unknown, response: EmptyResponse) {
  response.status(204).end();
}
