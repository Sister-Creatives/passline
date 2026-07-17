import { mutation } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";

/**
 * Mint a one-shot upload URL for any signed-in organizer.
 *
 * Organizer-scoped rather than event-scoped (cf. `eventContent.generateUploadUrl`,
 * which gates on `requireOwnedEvent`) because the settings pages that use it --
 * the organization logo and host-profile logos -- aren't attached to an event.
 * Minting a URL grants no access to any row: the setters that persist a
 * `storageId` are the ones that enforce ownership.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});
