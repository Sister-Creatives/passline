/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accessCodes from "../accessCodes.js";
import type * as analytics from "../analytics.js";
import type * as apiHttp from "../apiHttp.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as checkoutQuestions from "../checkoutQuestions.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib_capacity from "../lib/capacity.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_fees from "../lib/fees.js";
import type * as lib_slug from "../lib/slug.js";
import type * as orders from "../orders.js";
import type * as organizers from "../organizers.js";
import type * as promoCodes from "../promoCodes.js";
import type * as rsvps from "../rsvps.js";
import type * as ticketCheckin from "../ticketCheckin.js";
import type * as ticketTypes from "../ticketTypes.js";
import type * as waitlist from "../waitlist.js";
import type * as webhookDelivery from "../webhookDelivery.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accessCodes: typeof accessCodes;
  analytics: typeof analytics;
  apiHttp: typeof apiHttp;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  checkoutQuestions: typeof checkoutQuestions;
  crons: typeof crons;
  email: typeof email;
  events: typeof events;
  http: typeof http;
  "lib/capacity": typeof lib_capacity;
  "lib/constants": typeof lib_constants;
  "lib/fees": typeof lib_fees;
  "lib/slug": typeof lib_slug;
  orders: typeof orders;
  organizers: typeof organizers;
  promoCodes: typeof promoCodes;
  rsvps: typeof rsvps;
  ticketCheckin: typeof ticketCheckin;
  ticketTypes: typeof ticketTypes;
  waitlist: typeof waitlist;
  webhookDelivery: typeof webhookDelivery;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
