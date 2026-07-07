import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Registers the Convex Auth HTTP routes:
// - /.well-known/openid-configuration
// - /.well-known/jwks.json
// - /api/auth/* (only when an OAuth provider is configured)
auth.addHttpRoutes(http);

export default http;
