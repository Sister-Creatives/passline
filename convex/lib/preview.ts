import type { Doc } from "../_generated/dataModel";

/**
 * May this event be read on the public surface: published, or a draft whose
 * preview token was supplied. Bypasses the published gate for reads ONLY --
 * writes (e.g. rsvps.rsvp via publishedEventBySlug) stay gated on `status`
 * and never consult this helper.
 */
export function canViewEvent(event: Doc<"events">, previewToken?: string): boolean {
  return event.status === "published" || (!!previewToken && previewToken === event.previewToken);
}
