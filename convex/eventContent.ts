import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";
import { isValidHexColor, parseVideoEmbed } from "./lib/eventContent";

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

type AgendaRow = { time: string; title: string; description?: string };
type SpeakerRow = { name: string; title?: string; bio?: string; imageUrl?: string };
type FaqRow = { question: string; answer: string };

const agendaRowValidator = v.object({
  time: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
});
const speakerRowValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  bio: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
});
const faqRowValidator = v.object({ question: v.string(), answer: v.string() });

type Accessibility = {
  wheelchairAccessible?: boolean;
  signLanguage?: boolean;
  closedCaptions?: boolean;
  hearingLoop?: boolean;
  accessibleParking?: boolean;
  assistanceAnimalsWelcome?: boolean;
  notes?: string;
};

const accessibilityValidator = v.object({
  wheelchairAccessible: v.optional(v.boolean()),
  signLanguage: v.optional(v.boolean()),
  closedCaptions: v.optional(v.boolean()),
  hearingLoop: v.optional(v.boolean()),
  accessibleParking: v.optional(v.boolean()),
  assistanceAnimalsWelcome: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

const MAX_ROWS = 50;

/** The shape returned in place of a real doc when no `eventContent` row exists yet. */
function emptyContent(): { agenda: AgendaRow[]; speakers: SpeakerRow[]; faqs: FaqRow[] } {
  return { agenda: [], speakers: [], faqs: [] };
}

/** Trim a string; an empty (or omitted) value normalizes to `undefined` (i.e. "clear this field"). */
function normalizeOptionalString(s: string | undefined): string | undefined {
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
}

/** Trim every field, drop rows whose title is blank, cap at MAX_ROWS. */
function normalizeAgenda(rows: AgendaRow[]): AgendaRow[] {
  return rows
    .map((row) => ({
      time: row.time.trim(),
      title: row.title.trim(),
      description: normalizeOptionalString(row.description),
    }))
    .filter((row) => row.title.length > 0)
    .slice(0, MAX_ROWS);
}

/** Trim every field, drop rows whose name is blank, cap at MAX_ROWS. */
function normalizeSpeakers(rows: SpeakerRow[]): SpeakerRow[] {
  return rows
    .map((row) => ({
      name: row.name.trim(),
      title: normalizeOptionalString(row.title),
      bio: normalizeOptionalString(row.bio),
      imageUrl: normalizeOptionalString(row.imageUrl),
    }))
    .filter((row) => row.name.length > 0)
    .slice(0, MAX_ROWS);
}

/** Trim both fields, drop rows where either the question or the answer is blank, cap at MAX_ROWS. */
function normalizeFaqs(rows: FaqRow[]): FaqRow[] {
  return rows
    .map((row) => ({ question: row.question.trim(), answer: row.answer.trim() }))
    .filter((row) => row.question.length > 0 && row.answer.length > 0)
    .slice(0, MAX_ROWS);
}

/** Trim `notes`; an accessibility block with no fields set normalizes to `undefined` (clears it). */
function normalizeAccessibility(a: Accessibility | undefined): Accessibility | undefined {
  if (!a) return undefined;
  const normalized: Accessibility = {
    wheelchairAccessible: a.wheelchairAccessible,
    signLanguage: a.signLanguage,
    closedCaptions: a.closedCaptions,
    hearingLoop: a.hearingLoop,
    accessibleParking: a.accessibleParking,
    assistanceAnimalsWelcome: a.assistanceAnimalsWelcome,
    notes: normalizeOptionalString(a.notes),
  };
  const hasAnyField = Object.values(normalized).some((value) => value !== undefined);
  return hasAnyField ? normalized : undefined;
}

/** Owner-only: an event's page content, or an empty default if none has been saved yet. */
export const get = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const content = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    return content ?? emptyContent();
  },
});

/**
 * Owner-only: upsert an event's page content (patch the existing `by_event`
 * row, or insert one if this is the first save). `brandColor` and `videoUrl`
 * are the only organizer-supplied values ever interpolated into markup (a CSS
 * variable / inline style and an iframe `src`, respectively -- see F12 spec
 * §4/§9), so each is strictly validated when non-empty and rejected otherwise;
 * an empty value clears the field. Every string is trimmed, agenda/speaker/faq
 * rows missing their required field(s) are dropped, and each array is capped
 * at MAX_ROWS.
 */
export const update = mutation({
  args: {
    eventId: v.id("events"),
    coverImageUrl: v.optional(v.string()),
    brandColor: v.optional(v.string()),
    ctaLabel: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    agenda: v.array(agendaRowValidator),
    speakers: v.array(speakerRowValidator),
    faqs: v.array(faqRowValidator),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const brandColor = normalizeOptionalString(args.brandColor);
    if (brandColor !== undefined && !isValidHexColor(brandColor)) {
      throw new Error("Brand color must be a 6-digit hex code like #1a2b3c");
    }

    const videoUrl = normalizeOptionalString(args.videoUrl);
    if (videoUrl !== undefined && !parseVideoEmbed(videoUrl)) {
      throw new Error("Video URL must be a YouTube or Vimeo link");
    }

    const patch = {
      coverImageUrl: normalizeOptionalString(args.coverImageUrl),
      brandColor,
      ctaLabel: normalizeOptionalString(args.ctaLabel),
      videoUrl,
      agenda: normalizeAgenda(args.agenda),
      speakers: normalizeSpeakers(args.speakers),
      faqs: normalizeFaqs(args.faqs),
    };

    const existing = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("eventContent", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      ...patch,
    });
  },
});

/**
 * Owner-only: upsert an event's accessibility info + cover-image alt text.
 * Patches ONLY `coverImageAlt` + `accessibility`, leaving the F12 page-content
 * fields (agenda/speakers/faqs/coverImageUrl/brandColor/ctaLabel/videoUrl)
 * untouched. `notes` is trimmed; an omitted/empty value clears the
 * corresponding field. If no content doc exists yet, inserts one with empty
 * page-content arrays plus these fields.
 */
export const updateAccessibility = mutation({
  args: {
    eventId: v.id("events"),
    coverImageAlt: v.optional(v.string()),
    accessibility: v.optional(accessibilityValidator),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const patch = {
      coverImageAlt: normalizeOptionalString(args.coverImageAlt),
      accessibility: normalizeAccessibility(args.accessibility),
    };

    const existing = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("eventContent", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      ...emptyContent(),
      ...patch,
    });
  },
});

/**
 * Public: a published event's page content (or an empty default so the
 * storefront can render unconditionally), by slug. Mirrors
 * `events.getEventBySlug`'s non-disclosure of drafts -- returns null rather
 * than throwing for a missing or unpublished event.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!event || event.status !== "published") return null;

    const content = await ctx.db
      .query("eventContent")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .unique();
    return content ?? emptyContent();
  },
});
