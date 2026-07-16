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
import type * as addOns from "../addOns.js";
import type * as analytics from "../analytics.js";
import type * as apiHttp from "../apiHttp.js";
import type * as apiKeys from "../apiKeys.js";
import type * as attendees from "../attendees.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as checkoutQuestions from "../checkoutQuestions.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as email from "../email.js";
import type * as eventContent from "../eventContent.js";
import type * as eventSessions from "../eventSessions.js";
import type * as events from "../events.js";
import type * as hostProfiles from "../hostProfiles.js";
import type * as http from "../http.js";
import type * as lib_capacity from "../lib/capacity.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_eventContent from "../lib/eventContent.js";
import type * as lib_eventStats from "../lib/eventStats.js";
import type * as lib_eventTaxonomy from "../lib/eventTaxonomy.js";
import type * as lib_fees from "../lib/fees.js";
import type * as lib_readiness from "../lib/readiness.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_timeseries from "../lib/timeseries.js";
import type * as marketing from "../marketing.js";
import type * as migrations from "../migrations.js";
import type * as orders from "../orders.js";
import type * as organizers from "../organizers.js";
import type * as promoCodes from "../promoCodes.js";
import type * as reports from "../reports.js";
import type * as rsvps from "../rsvps.js";
import type * as seats from "../seats.js";
import type * as seed from "../seed.js";
import type * as sidebar from "../sidebar.js";
import type * as ticketCheckin from "../ticketCheckin.js";
import type * as ticketTypes from "../ticketTypes.js";
import type * as tickets from "../tickets.js";
import type * as virtualHub from "../virtualHub.js";
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
  addOns: typeof addOns;
  analytics: typeof analytics;
  apiHttp: typeof apiHttp;
  apiKeys: typeof apiKeys;
  attendees: typeof attendees;
  audit: typeof audit;
  auth: typeof auth;
  checkoutQuestions: typeof checkoutQuestions;
  crons: typeof crons;
  dashboard: typeof dashboard;
  email: typeof email;
  eventContent: typeof eventContent;
  eventSessions: typeof eventSessions;
  events: typeof events;
  hostProfiles: typeof hostProfiles;
  http: typeof http;
  "lib/capacity": typeof lib_capacity;
  "lib/constants": typeof lib_constants;
  "lib/eventContent": typeof lib_eventContent;
  "lib/eventStats": typeof lib_eventStats;
  "lib/eventTaxonomy": typeof lib_eventTaxonomy;
  "lib/fees": typeof lib_fees;
  "lib/readiness": typeof lib_readiness;
  "lib/slug": typeof lib_slug;
  "lib/timeseries": typeof lib_timeseries;
  marketing: typeof marketing;
  migrations: typeof migrations;
  orders: typeof orders;
  organizers: typeof organizers;
  promoCodes: typeof promoCodes;
  reports: typeof reports;
  rsvps: typeof rsvps;
  seats: typeof seats;
  seed: typeof seed;
  sidebar: typeof sidebar;
  ticketCheckin: typeof ticketCheckin;
  ticketTypes: typeof ticketTypes;
  tickets: typeof tickets;
  virtualHub: typeof virtualHub;
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
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
