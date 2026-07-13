import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { listEvents, listTicketTypes, createOrder } from "./apiHttp";

const http = httpRouter();

// Registers the Convex Auth HTTP routes:
// - /.well-known/openid-configuration
// - /.well-known/jwks.json
// - /api/auth/* (only when an OAuth provider is configured)
auth.addHttpRoutes(http);

// Versioned, API-key-authenticated read API (see convex/apiHttp.ts).
http.route({ path: "/v1/events", method: "GET", handler: listEvents });
// No path params in Convex's router, so the {eventId} segment is parsed out
// of the URL inside listTicketTypes.
http.route({ pathPrefix: "/v1/events/", method: "GET", handler: listTicketTypes });
// Versioned, API-key-authenticated headless checkout endpoint.
http.route({ path: "/v1/orders", method: "POST", handler: createOrder });

export default http;
