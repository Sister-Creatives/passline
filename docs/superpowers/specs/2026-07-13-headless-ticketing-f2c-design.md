# Passline → Headless Ticketing — F2c: Typed SDK

- **Date:** 2026-07-13
- **Status:** Approved design (autonomous loop)
- **Slice:** F2c — a typed TypeScript client for the F2 HTTP read API

## 1. Goal

Give developers a typed, ergonomic client for the headless HTTP API instead of hand-rolling
`fetch` calls. Ships as a **self-contained, dependency-free module** (`sdk/passline.ts`) that
can later be extracted into a publishable `@passline/sdk` package.

## 2. Scope

**In:** `sdk/passline.ts` — a `PasslineClient` wrapping the F2 endpoints (`GET /v1/events`,
`GET /v1/events/{eventId}/ticket-types`) with typed request/response and a typed error; unit
tests with a mocked `fetch`; a `sdk/README.md` usage doc.

**Out:** write/checkout methods (arrive with F3); npm publishing config; webhook-signature
verification helper (a natural F2c+ addition, deferred); pagination (the API returns full lists
today).

## 3. Module — `sdk/passline.ts`

Dependency-free (uses global `fetch`; works in Node ≥18 and browsers). Exports:

```ts
export interface PasslineEvent {
  id: string; title: string; slug: string;
  status: "draft" | "published";
  capacity: number; currency: string;
  startsAt: number; endsAt: number;
}

export interface PasslineTicketType {
  id: string; name: string;
  kind: "paid" | "free" | "donation";
  priceCents: number; currency: string;
  capacity: number | null; sold: number;
  badge: string | null; sortOrder: number;
}

export class PasslineApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}

export interface PasslineClientOptions {
  apiKey: string;              // "pl_live_…"
  baseUrl: string;             // e.g. "https://<deployment>.convex.site"
  fetch?: typeof fetch;        // injectable for tests / custom runtimes
}

export class PasslineClient {
  constructor(options: PasslineClientOptions);
  listEvents(): Promise<PasslineEvent[]>;
  listTicketTypes(eventId: string): Promise<PasslineTicketType[]>;
}
```

**Behavior:**
- A private `request<T>(path)` does `fetch(baseUrl + path, { headers: { Authorization: "Bearer " + apiKey } })`.
- On a 2xx JSON `{ data: T }` → returns `data`.
- On non-2xx → throws `PasslineApiError(status, <error from JSON body or statusText>)`.
- `baseUrl` trailing slash is normalized; `eventId` is `encodeURIComponent`-ed into the path.
- The injectable `fetch` option defaults to the global `fetch`.

The types mirror the F2 HTTP payloads exactly (see F2 spec §5 / `convex/apiHttp.ts`).

## 4. Tests — `sdk/passline.test.ts`

Vitest with a mocked `fetch` (passed via the `fetch` option — no global stubbing needed):
- `listEvents` calls `GET {baseUrl}/v1/events` with the `Authorization: Bearer <key>` header and
  returns the parsed `data` array.
- `listTicketTypes` calls `GET {baseUrl}/v1/events/{id}/ticket-types` (id encoded) and returns
  `data`.
- a non-2xx response throws `PasslineApiError` carrying the status and the body's `error` message.
- trailing-slash `baseUrl` is normalized (no double slash).

## 5. Docs — `sdk/README.md`

Short: install/copy, instantiate with an API key + deployment URL, the two methods, and the
error type. Include a runnable snippet.

## 6. Constraints

Must pass the root `tsc --noEmit` (`noUnusedLocals`, `verbatimModuleSyntax`) and `pnpm build`.
Dependency-free. No secrets in the repo. Confirm `pnpm test` picks up `sdk/passline.test.ts`
(adjust `vitest.config.ts` include only if necessary).

## 7. Delivery

TDD → `pnpm test` + `tsc` + `build` green → push (stacked on F2b) → PR → loop to **F3
(checkout + orders + Stripe)** — which will need Stripe **test** API keys from the user (flag
before the payment step).
