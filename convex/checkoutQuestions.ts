import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthOrganizerId } from "./auth";

const kindValidator = v.union(v.literal("text"), v.literal("select"), v.literal("checkbox"));

/** Load an event and enforce that it belongs to the authenticated organizer. */
async function requireOwnedEvent(ctx: QueryCtx | MutationCtx, eventId: Id<"events">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const event = await ctx.db.get(eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return event;
}

/** Load a checkout question + its event, enforcing organizer ownership of the event. */
async function requireOwnedQuestion(ctx: QueryCtx | MutationCtx, questionId: Id<"checkoutQuestions">) {
  const organizerId = await getAuthOrganizerId(ctx);
  if (!organizerId) throw new Error("Not authenticated");
  const question = await ctx.db.get(questionId);
  if (!question) throw new Error("Not found");
  const event = await ctx.db.get(question.eventId);
  if (!event || event.organizerId !== organizerId) throw new Error("Not found");
  return { question, event };
}

export const create = mutation({
  args: {
    eventId: v.id("events"),
    label: v.string(),
    kind: kindValidator,
    options: v.optional(v.array(v.string())),
    required: v.boolean(),
  },
  handler: async (ctx, args) => {
    const event = await requireOwnedEvent(ctx, args.eventId);

    const label = args.label.trim();
    if (label.length === 0) throw new Error("Label is required");

    let options: string[] | undefined;
    if (args.kind === "select") {
      if (!args.options || args.options.length === 0) {
        throw new Error("A select question needs at least one option");
      }
      options = args.options.map((option) => option.trim());
      if (options.some((option) => option.length === 0)) {
        throw new Error("Options cannot be empty");
      }
    }

    const existing = await ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const sortOrder = existing.reduce((max, q) => Math.max(max, q.sortOrder), -1) + 1;

    return ctx.db.insert("checkoutQuestions", {
      eventId: args.eventId,
      organizerId: event.organizerId,
      label,
      kind: args.kind,
      options,
      required: args.required,
      sortOrder,
      active: true,
      createdAt: Date.now(),
    });
  },
});

/** Owner-only: every question for the event (including inactive), for the dashboard. */
export const list = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireOwnedEvent(ctx, eventId);
    const questions = await ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return questions.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Public: the active questions of a published event, sorted for rendering at
 * checkout. No account required (mirrors rsvps.getEventPublicState). Returns
 * an empty array -- rather than throwing -- for a missing or unpublished
 * event, since an empty question set is a valid checkout state.
 */
export const listForEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "published") return [];
    const questions = await ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    return questions.filter((q) => q.active).sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const remove = mutation({
  args: { questionId: v.id("checkoutQuestions") },
  handler: async (ctx, { questionId }) => {
    await requireOwnedQuestion(ctx, questionId);
    await ctx.db.delete(questionId);
    return null;
  },
});

/** Owner-only: rewrite sortOrder to match orderedIds. Mirrors ticketTypes.reorder. */
export const reorder = mutation({
  args: { eventId: v.id("events"), orderedIds: v.array(v.id("checkoutQuestions")) },
  handler: async (ctx, { eventId, orderedIds }) => {
    await requireOwnedEvent(ctx, eventId);
    const questions = await ctx.db
      .query("checkoutQuestions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const idSet = new Set(questions.map((q) => q._id));
    if (
      orderedIds.length !== questions.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      !orderedIds.every((id) => idSet.has(id))
    ) {
      throw new Error("orderedIds must be a permutation of the event's questions");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await ctx.db.patch(orderedIds[i], { sortOrder: i });
    }
    return null;
  },
});

/**
 * Validate a checkout's answers against an event's active questions and
 * return the snapshot rows to persist on the order. Plain helper (not a
 * Convex function) shared by the checkout path (convex/orders.ts
 * createOrder, F5.3), mirroring promoCodes.resolveAndComputeDiscount.
 *
 * - Answers are de-duped by questionId first (last value wins), so a client
 *   sending two answers for the same question yields one snapshot row.
 * - Every active `required` question must be satisfied: for a `checkbox`
 *   question the value must be exactly "true" (checked); for any other kind
 *   the value must be non-empty after trim.
 * - Every `checkbox` answer's value must be exactly "true" or "false".
 * - Every answer must reference a question that belongs to this event and is
 *   active -- an answer to an unknown, foreign, or inactive question throws.
 * - For a `select` question, the answered value must be one of its options.
 *
 * Throws (aborting the caller's mutation) on the first violation found.
 */
export async function validateAndSnapshotAnswers(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
  answers: { questionId: Id<"checkoutQuestions">; value: string }[],
): Promise<{ questionId: Id<"checkoutQuestions">; label: string; value: string }[]> {
  const questions = await ctx.db
    .query("checkoutQuestions")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const activeQuestions = questions.filter((q) => q.active);
  const activeById = new Map(activeQuestions.map((q) => [q._id, q]));

  // De-dupe by questionId -- last value wins -- so a client sending two
  // answers for the same question yields one snapshot row.
  const valueByQuestionId = new Map(answers.map((a) => [a.questionId, a.value]));

  for (const question of activeQuestions) {
    const value = valueByQuestionId.get(question._id);
    if (question.kind === "checkbox" && value !== undefined && value !== "true" && value !== "false") {
      throw new Error(`Invalid answer for "${question.label}"`);
    }
    if (!question.required) continue;
    if (question.kind === "checkbox") {
      if (value !== "true") {
        throw new Error(`"${question.label}" must be checked`);
      }
    } else if (value === undefined || value.trim().length === 0) {
      throw new Error(`"${question.label}" is required`);
    }
  }

  return Array.from(valueByQuestionId.entries()).map(([questionId, value]) => {
    const question = activeById.get(questionId);
    if (!question) throw new Error("Answer given for an unknown question");
    if (question.kind === "select" && !(question.options ?? []).includes(value)) {
      throw new Error(`"${value}" is not a valid option for "${question.label}"`);
    }
    return { questionId: question._id, label: question.label, value };
  });
}
