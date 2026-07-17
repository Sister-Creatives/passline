# Passline SDK

A small, dependency-free TypeScript client for the Passline headless HTTP
API. Everything lives in `sdk/passline.ts` — no imports beyond built-in
`fetch`/`Response`, so it can be copied out of this repo into any project.

## Usage

```ts
import { PasslineClient, PasslineApiError } from "./passline";

const client = new PasslineClient({
  apiKey: "pl_live_…",
  baseUrl: "https://<deployment>.convex.site",
});

try {
  const events = await client.listEvents();
  console.log(events);
} catch (err) {
  if (err instanceof PasslineApiError) {
    console.error(`Passline API error (${err.status}): ${err.message}`);
  } else {
    throw err;
  }
}
```

## Instantiation

```ts
new PasslineClient({
  apiKey: string;        // "pl_live_…"
  baseUrl: string;       // e.g. "https://<deployment>.convex.site"
  fetch?: typeof fetch;  // optional, injectable for tests / custom runtimes
});
```

A trailing slash on `baseUrl` is fine — it's normalized away.

## Methods

- **`listEvents(): Promise<PasslineEvent[]>`** — `GET /v1/events`. Returns
  the caller's events.
- **`listTicketTypes(eventId: string): Promise<PasslineTicketType[]>`** —
  `GET /v1/events/{eventId}/ticket-types`. Returns that event's ticket
  types. `eventId` is URI-encoded automatically.

## Errors

Any non-2xx response throws `PasslineApiError`, which extends `Error` and
adds:

- **`status: number`** — the HTTP status code.
- **`message: string`** — the API's `error` field if present, otherwise the
  response's status text.
