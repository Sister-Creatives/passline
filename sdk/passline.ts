/**
 * Self-contained TypeScript client for the Passline headless HTTP API
 * (see convex/apiHttp.ts). No dependencies beyond built-in `fetch`/
 * `Response` — safe to copy out of this repo and drop into any project.
 */

export interface PasslineEvent {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  capacity: number;
  currency: string;
  startsAt: number;
  endsAt: number;
}

export interface PasslineTicketType {
  id: string;
  name: string;
  kind: "paid" | "free" | "donation";
  priceCents: number;
  currency: string;
  capacity: number | null;
  sold: number;
  badge: string | null;
  sortOrder: number;
}

export class PasslineApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PasslineApiError";
    this.status = status;
  }
}

export interface PasslineClientOptions {
  /** API key, e.g. "pl_live_…". Sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** e.g. "https://<deployment>.convex.site" — a trailing slash is fine. */
  baseUrl: string;
  /** Injectable for tests / non-global-fetch runtimes. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

interface DataEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error?: string;
}

export class PasslineClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: PasslineClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? fetch;
  }

  async listEvents(): Promise<PasslineEvent[]> {
    const { data } = await this.request<PasslineEvent[]>("/v1/events");
    return data;
  }

  async listTicketTypes(eventId: string): Promise<PasslineTicketType[]> {
    const { data } = await this.request<PasslineTicketType[]>(
      `/v1/events/${encodeURIComponent(eventId)}/ticket-types`,
    );
    return data;
  }

  private async request<T>(path: string): Promise<DataEnvelope<T>> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as ErrorEnvelope;
        if (body.error) message = body.error;
      } catch {
        // Body wasn't parseable JSON — fall back to statusText.
      }
      throw new PasslineApiError(response.status, message);
    }

    return (await response.json()) as DataEnvelope<T>;
  }
}
