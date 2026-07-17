import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { listEvents, listEventSubResource, createOrder } from "./apiHttp";

const http = httpRouter();

// Registers the Convex Auth HTTP routes:
// - /.well-known/openid-configuration
// - /.well-known/jwks.json
// - /api/auth/* (only when an OAuth provider is configured)
auth.addHttpRoutes(http);

// Versioned, API-key-authenticated read API (see convex/apiHttp.ts).
http.route({ path: "/v1/events", method: "GET", handler: listEvents });
// No path params in Convex's router, so the {eventId} segment (and which
// sub-resource -- ticket-types or questions -- follows it) is parsed out of
// the URL inside listEventSubResource; a single pathPrefix registration is
// required since Convex's httpRouter allows only one handler per
// (method, pathPrefix).
http.route({ pathPrefix: "/v1/events/", method: "GET", handler: listEventSubResource });
// Versioned, API-key-authenticated headless checkout endpoint.
http.route({ path: "/v1/orders", method: "POST", handler: createOrder });

export default http;
