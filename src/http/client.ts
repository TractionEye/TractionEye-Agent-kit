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
    return this._request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this._request<T>('POST', path, body);
  }

  private async _request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `agent ${this.agentToken}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    const parsed = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      throw new TractionEyeHttpError(
        `HTTP ${res.status} for ${method} ${path}`,
        res.status,
        parsed ?? text,
      );
    }

    return (parsed ?? {}) as T;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
