export class TractionEyeHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'TractionEyeHttpError';
  }
}

export class TractionEyeHttpClient {
  constructor(private readonly baseUrl: string, private readonly agentToken: string) {}

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `agent ${this.agentToken}`,
        Accept: 'application/json',
      },
    });

    const text = await res.text();
    const body = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      throw new TractionEyeHttpError(`HTTP ${res.status} for GET ${path}`, res.status, body ?? text);
    }

    return (body ?? {}) as T;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
