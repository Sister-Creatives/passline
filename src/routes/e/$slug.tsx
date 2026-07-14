import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { RsvpForm } from "@/components/RsvpForm";
import { TrackingPixels } from "@/components/TrackingPixels";
import { formatEventDateRange } from "@/lib/format-event-date";

// PUBLIC route: no AuthGuard. Anyone with the link can view a published
// event and RSVP -- this is the attendee-facing surface, not the organizer's.
export const Route = createFileRoute("/e/$slug")({
  // Prefetch the event for SSR/SEO: the crawler/first paint gets real HTML
  // instead of a loading state, and useSuspenseQuery below reads the same
  // cached entry so there's no duplicate fetch on hydration. The loader
  // also returns the event so `head` below can build a per-event <title>.
  loader: async ({ params, context }) => {
    const event = await context.queryClient.ensureQueryData(
      convexQuery(api.events.getEventBySlug, { slug: params.slug }),
    );
    return { event };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.event
          ? `${stripHtml(loaderData.event.title)} — Passline`
          : "Event — Passline",
      },
    ],
  }),
  component: EventPage,
});

// Event titles may contain inline <i>/<em>/<br>/<strong> markup for display;
// strip it for the plain-text <title> tag.
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function EventPage() {
  const { slug } = Route.useParams();
  return (
    <Suspense
      fallback={<div className="p-8 text-sm text-muted-foreground">Loading event…</div>}
    >
      <EventPageContent slug={slug} />
    </Suspense>
  );
}

function EventPageContent({ slug }: { slug: string }) {
  const { data: event } = useSuspenseQuery(convexQuery(api.events.getEventBySlug, { slug }));

  if (!event) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-semibold">Event not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This event does not exist or is no longer published.
        </p>
      </div>
    );
  }

  return <EventDetails slug={slug} event={event} />;
}

function EventDetails({ slug, event }: { slug: string; event: Doc<"events"> }) {
  // Separate hook, separate component: keeps this query out of the branch
  // above so hook order never depends on whether the event was found.
  const { data: publicState } = useSuspenseQuery(
    convexQuery(api.rsvps.getEventPublicState, { slug }),
  );
  const isFull = publicState.seatsTaken >= publicState.capacity;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <TrackingPixels
        metaPixelId={event.metaPixelId}
        googleAnalyticsId={event.googleAnalyticsId}
        gtmId={event.gtmId}
      />
      {/* Authors may embed inline <i>/<em>/<br>/<strong> in the title. */}
      <h1
        className="text-2xl font-semibold sm:text-3xl"
        dangerouslySetInnerHTML={{ __html: event.title }}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        {formatEventDateRange(event.startsAt, event.endsAt)}
      </p>
      <p className="text-sm text-muted-foreground">{event.location}</p>
      <p className="mt-4 text-sm whitespace-pre-line">{event.description}</p>

      <p className="mt-6 text-sm font-medium">
        {publicState.seatsTaken} of {publicState.capacity} spots taken
      </p>

      <div className="mt-6 max-w-sm">
        <RsvpForm slug={slug} isFull={isFull} />
      </div>
    </div>
  );
}
