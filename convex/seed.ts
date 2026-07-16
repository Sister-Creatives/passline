import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthOrganizerId } from "./auth";
import type { Id } from "./_generated/dataModel";

/**
 * Dev-only sample data. Creates a realistic set of events (one live now, a few
 * upcoming, one past, one draft) with attendees, paid orders, and a couple of
 * email campaigns for the organizer -- enough to populate the dashboard,
 * reports, attendees, marketing, and the sidebar counts.
 *
 * Idempotent: every seeded event is tagged with the "seed" keyword, and the run
 * bails out if any already exist. Resolve the organizer from an explicit id, an
 * email, or the signed-in session (in that order), so it can be run from the
 * app or via `npx convex run seed:seed '{"email":"you@example.com"}'`.
 */

const FIRST = [
  "Ava", "Liam", "Mia", "Noah", "Ella", "Kai", "Zoe", "Leo", "Ruby", "Finn",
  "Ivy", "Jack", "Aria", "Max", "Lily", "Sam", "Nora", "Ben", "Grace", "Owen",
  "Isla", "Cody", "Maya", "Eli", "Freya", "Toby", "Hana", "Milo", "Sadie", "Rex",
];
const LAST = [
  "Chen", "Ford", "Reed", "Park", "Ryan", "Blake", "Nguyen", "Cole", "Hart",
  "Frost", "Wells", "Shaw", "Diaz", "Lowe", "Kerr", "Vance", "Pena", "Roe",
];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);

type FreePlan = { confirmed: number; checkedIn: number; waitlisted: number };
type EventConfig = {
  title: string;
  desc: string;
  start: number;
  end: number;
  location: string;
  capacity: number;
  status: "published" | "draft";
  ticket: { name: string; kind: "free" | "paid"; price: number } | null;
  free?: FreePlan;
  sold?: number;
};

export const seed = mutation({
  args: {
    organizerId: v.optional(v.id("organizers")),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let organizerId: Id<"organizers"> | null = args.organizerId ?? null;
    if (!organizerId && args.email) {
      const org = await ctx.db
        .query("organizers")
        .withIndex("by_email", (q) => q.eq("email", args.email!))
        .unique();
      organizerId = org?._id ?? null;
    }
    if (!organizerId) organizerId = await getAuthOrganizerId(ctx);
    if (!organizerId) {
      throw new Error(
        "No organizer resolved. Pass { email } or { organizerId }, or run while signed in.",
      );
    }
    const orgId = organizerId;
    const now = Date.now();

    const existing = await ctx.db
      .query("events")
      .withIndex("by_organizer", (q) => q.eq("organizerId", orgId))
      .collect();
    if (existing.some((e) => (e.keywords ?? []).includes("seed"))) {
      return { seeded: false, message: "Already seeded (seed events exist)." };
    }

    let pIdx = 0;
    const person = () => {
      const f = FIRST[pIdx % FIRST.length];
      const l = LAST[(pIdx * 3) % LAST.length];
      pIdx += 1;
      return {
        name: `${f} ${l}`,
        email: `${f}.${l}${pIdx}`.toLowerCase() + "@example.com",
      };
    };

    const currency = "AUD";
    const feeMode = "pass" as const;

    const configs: EventConfig[] = [
      {
        title: "Summer Solstice Gathering",
        desc: "An evening of food, live music, and lanterns under the canopy.",
        start: now - 1 * HOUR,
        end: now + 3 * HOUR,
        location: "Mornington Green, Somerville VIC",
        capacity: 200,
        status: "published",
        ticket: { name: "General Admission", kind: "free", price: 0 },
        free: { confirmed: 22, checkedIn: 9, waitlisted: 3 },
      },
      {
        title: "Autumn Wine & Music Night",
        desc: "Regional wines paired with an acoustic set as the sun goes down.",
        start: now + 8 * DAY,
        end: now + 8 * DAY + 4 * HOUR,
        location: "The Grove, Mornington VIC",
        capacity: 120,
        status: "published",
        ticket: { name: "General Admission", kind: "paid", price: 4500 },
        sold: 34,
      },
      {
        title: "Founders Community Dinner",
        desc: "A long-table dinner celebrating the people who planted the first trees.",
        start: now + 20 * DAY,
        end: now + 20 * DAY + 3 * HOUR,
        location: "Mornington Green, Somerville VIC",
        capacity: 80,
        status: "published",
        ticket: { name: "Seat", kind: "paid", price: 12000 },
        sold: 21,
      },
      {
        title: "Memorial Forest Open Day",
        desc: "Walk the forest, meet the team, and learn how living legacies grow.",
        start: now - 14 * DAY,
        end: now - 14 * DAY + 6 * HOUR,
        location: "Wellington Dam, Collie WA",
        capacity: 300,
        status: "published",
        ticket: { name: "Entry", kind: "free", price: 0 },
        free: { confirmed: 10, checkedIn: 84, waitlisted: 0 },
      },
      {
        title: "Sunset Yoga in the Grove",
        desc: "A gentle all-levels flow among the trees, mats provided.",
        start: now + 3 * DAY,
        end: now + 3 * DAY + 90 * 60 * 1000,
        location: "The Grove, Mornington VIC",
        capacity: 40,
        status: "published",
        ticket: { name: "Spot", kind: "free", price: 0 },
        free: { confirmed: 27, checkedIn: 0, waitlisted: 4 },
      },
      {
        title: "Winter Planting Workshop",
        desc: "Hands-on session on native planting and forest care.",
        start: now + 35 * DAY,
        end: now + 35 * DAY + 2 * HOUR,
        location: "Mornington Green, Somerville VIC",
        capacity: 60,
        status: "draft",
        ticket: null,
      },
    ];

    let eventsCreated = 0;
    let attendeesCreated = 0;
    let ordersCreated = 0;
    let revenueCents = 0;

    for (const c of configs) {
      const slug =
        c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") +
        "-" +
        rid(4);
      const eventId = await ctx.db.insert("events", {
        organizerId: orgId,
        title: c.title,
        description: c.desc,
        startsAt: c.start,
        endsAt: c.end,
        location: c.location,
        capacity: c.capacity,
        status: c.status,
        slug,
        currency,
        feeMode,
        keywords: ["seed"],
      });
      eventsCreated += 1;

      if (!c.ticket) continue;

      const ticketTypeId = await ctx.db.insert("ticketTypes", {
        eventId,
        name: c.ticket.name,
        kind: c.ticket.kind,
        priceCents: c.ticket.price,
        capacity: c.capacity,
        sold: 0,
        visibility: "visible",
        sortOrder: 0,
        status: "active",
      });

      if (c.ticket.kind === "free" && c.free) {
        let sold = 0;
        for (let i = 0; i < c.free.confirmed; i++) {
          const p = person();
          await ctx.db.insert("rsvps", {
            eventId,
            name: p.name,
            email: p.email,
            token: `rsvp-${rid()}`,
            status: "confirmed",
          });
          attendeesCreated += 1;
          sold += 1;
        }
        for (let i = 0; i < c.free.checkedIn; i++) {
          const p = person();
          const at = Math.min(c.start + Math.floor(Math.random() * (c.end - c.start)), now);
          await ctx.db.insert("rsvps", {
            eventId,
            name: p.name,
            email: p.email,
            token: `rsvp-${rid()}`,
            status: "checked_in",
            checkedInAt: at,
          });
          attendeesCreated += 1;
          sold += 1;
        }
        for (let i = 0; i < c.free.waitlisted; i++) {
          const p = person();
          await ctx.db.insert("rsvps", {
            eventId,
            name: p.name,
            email: p.email,
            token: `rsvp-${rid()}`,
            status: "waitlisted",
            waitlistPosition: i + 1,
          });
          attendeesCreated += 1;
        }
        await ctx.db.patch(ticketTypeId, { sold });
      }

      if (c.ticket.kind === "paid" && c.sold) {
        const isPast = c.end < now;
        let sold = 0;
        for (let i = 0; i < c.sold; i++) {
          const p = person();
          const paidAt =
            now - Math.floor(Math.random() * 21) * DAY - Math.floor(Math.random() * 12 * HOUR);
          const subtotal = c.ticket.price;
          const orderId = await ctx.db.insert("orders", {
            eventId,
            organizerId: orgId,
            buyerName: p.name,
            buyerEmail: p.email,
            status: "paid",
            currency,
            feeMode,
            subtotalCents: subtotal,
            feeCents: 0,
            totalCents: subtotal,
            payoutCents: subtotal,
            token: `ord-${rid()}`,
            createdAt: paidAt,
            paidAt,
            paymentMethod: "online",
            source: "online",
          });
          await ctx.db.insert("orderItems", {
            orderId,
            ticketTypeId,
            quantity: 1,
            unitPriceCents: subtotal,
          });
          const checkedIn = isPast && Math.random() < 0.6;
          await ctx.db.insert("tickets", {
            orderId,
            eventId,
            ticketTypeId,
            code: `TIX-${rid(6).toUpperCase()}`,
            status: checkedIn ? "checked_in" : "valid",
            attendeeName: p.name,
            attendeeEmail: p.email,
            createdAt: paidAt,
            ...(checkedIn
              ? { checkedInAt: c.start + Math.floor(Math.random() * (c.end - c.start)) }
              : {}),
          });
          attendeesCreated += 1;
          ordersCreated += 1;
          revenueCents += subtotal;
          sold += 1;
        }
        await ctx.db.patch(ticketTypeId, { sold });
      }
    }

    const seededPublished = (
      await ctx.db
        .query("events")
        .withIndex("by_organizer", (q) => q.eq("organizerId", orgId))
        .collect()
    ).filter((e) => e.status === "published" && (e.keywords ?? []).includes("seed"));
    const campaignSubjects = ["Last call for tickets", "You're on the list"];
    for (let i = 0; i < Math.min(2, seededPublished.length); i++) {
      await ctx.db.insert("emailCampaigns", {
        eventId: seededPublished[i]._id,
        organizerId: orgId,
        subject: campaignSubjects[i],
        body: "<p>Thanks for being part of it. See you there.</p>",
        recipientCount: 40 + i * 25,
        createdAt: now - (i + 1) * 3 * DAY,
      });
    }

    return {
      seeded: true,
      eventsCreated,
      attendeesCreated,
      ordersCreated,
      revenueDollars: Math.round(revenueCents / 100),
    };
  },
});
