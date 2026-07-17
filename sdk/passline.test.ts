import { describe, expect, it, vi } from "vitest";
import { PasslineApiError, PasslineClient } from "./passline";

const BASE_URL = "https://my-deployment.convex.site";
const API_KEY = "pl_live_test123";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PasslineClient", () => {
  describe("listEvents", () => {
    it("calls GET {baseUrl}/v1/events with the bearer auth header and returns data", async () => {
      const events = [
        {
          id: "evt_1",
          title: "Launch Party",
          slug: "launch-party",
          status: "published" as const,
          capacity: 100,
          currency: "USD",
          startsAt: 1000,
          endsAt: 2000,
        },
      ];
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: events }));
      const client = new PasslineClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: fetchMock });

      const result = await client.listEvents();

      expect(result).toEqual(events);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, requestInit] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE_URL}/v1/events`);
      expect(requestInit?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    });
  });

  describe("listTicketTypes", () => {
    it("calls GET {baseUrl}/v1/events/{id}/ticket-types with the id URI-encoded and returns data", async () => {
      const ticketTypes = [
        {
          id: "tt_1",
          name: "General Admission",
          kind: "paid" as const,
          priceCents: 5000,
          currency: "USD",
          capacity: 50,
          sold: 10,
          badge: null,
          sortOrder: 0,
        },
      ];
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: ticketTypes }));
      const client = new PasslineClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: fetchMock });

      const result = await client.listTicketTypes("evt/weird id");

      expect(result).toEqual(ticketTypes);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, requestInit] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE_URL}/v1/events/${encodeURIComponent("evt/weird id")}/ticket-types`);
      expect(requestInit?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    });

    it("throws PasslineApiError with status and message on a non-2xx response", async () => {
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
        jsonResponse({ error: "not found" }, { status: 404 }),
      );
      const client = new PasslineClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: fetchMock });

      await expect(client.listTicketTypes("evt_missing")).rejects.toMatchObject({
        status: 404,
        message: "not found",
      });
      await expect(client.listTicketTypes("evt_missing")).rejects.toBeInstanceOf(PasslineApiError);
    });
  });

  describe("baseUrl normalization", () => {
    it("strips a trailing slash from baseUrl so requests don't double up on slashes", async () => {
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) => jsonResponse({ data: [] }));
      const client = new PasslineClient({
        apiKey: API_KEY,
        baseUrl: `${BASE_URL}/`,
        fetch: fetchMock,
      });

      await client.listEvents();

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE_URL}/v1/events`);
    });
  });

  describe("error handling", () => {
    it("falls back to statusText when the error body isn't JSON", async () => {
      const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
        new Response("upstream boom", { status: 502, statusText: "Bad Gateway" }),
      );
      const client = new PasslineClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: fetchMock });

      await expect(client.listEvents()).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
    });
  });
});
