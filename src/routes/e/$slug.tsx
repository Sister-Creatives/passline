import { Suspense } from "react";
import type { CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { isValidHexColor, parseVideoEmbed } from "../../../convex/lib/eventContent";
import { RsvpForm } from "@/components/RsvpForm";
import { TrackingPixels } from "@/components/TrackingPixels";
import { formatEventDateRange } from "@/lib/format-event-date";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";

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

// Initials for a speaker avatar's fallback (first letter of up to the first
// two whitespace-separated words of their name).
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
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

// eventContent.getBySlug returns either the real doc or a plain "empty
// defaults" object (see convex/eventContent.ts emptyContent()) -- those two
// shapes only structurally share the array fields, so this normalizes both
// into one friendly optional-fields shape for the JSX below instead of
// accessing the raw union everywhere.
type PublicEventContent = {
  coverImageUrl?: string;
  brandColor?: string;
  ctaLabel?: string;
  videoUrl?: string;
  agenda: Doc<"eventContent">["agenda"];
  speakers: Doc<"eventContent">["speakers"];
  faqs: Doc<"eventContent">["faqs"];
};

function EventDetails({ slug, event }: { slug: string; event: Doc<"events"> }) {
  // Separate hook, separate component: keeps this query out of the branch
  // above so hook order never depends on whether the event was found.
  const { data: publicState } = useSuspenseQuery(
    convexQuery(api.rsvps.getEventPublicState, { slug }),
  );
  const { data: rawContent } = useSuspenseQuery(
    convexQuery(api.eventContent.getBySlug, { slug }),
  );
  const content = rawContent as PublicEventContent | null;
  const isFull = publicState.seatsTaken >= publicState.capacity;

  // Brand color is organizer-supplied and gets interpolated into markup (a
  // CSS custom property, then a background-color) -- re-validate client-side
  // even though eventContent.update already validated it server-side.
  const hasBrand = !!content?.brandColor && isValidHexColor(content.brandColor);
  const brandColor = hasBrand ? content!.brandColor : undefined;

  const embed = content?.videoUrl ? parseVideoEmbed(content.videoUrl) : null;
  const embedSrc =
    embed?.provider === "youtube"
      ? `https://www.youtube.com/embed/${embed.id}`
      : embed?.provider === "vimeo"
        ? `https://player.vimeo.com/video/${embed.id}`
        : null;

  return (
    <div
      className="mx-auto max-w-2xl p-4 sm:p-8"
      style={brandColor ? ({ "--brand": brandColor } as CSSProperties) : undefined}
    >
      <TrackingPixels
        metaPixelId={event.metaPixelId}
        googleAnalyticsId={event.googleAnalyticsId}
        gtmId={event.gtmId}
      />

      {content?.coverImageUrl && (
        <img
          src={content.coverImageUrl}
          alt=""
          loading="lazy"
          className="mb-6 max-h-80 w-full max-w-full rounded-lg object-cover"
        />
      )}

      {/* Authors may embed inline <i>/<em>/<br>/<strong> in the title. */}
      <h1
        className="text-2xl font-semibold sm:text-3xl"
        style={brandColor ? { color: "var(--brand)" } : undefined}
        dangerouslySetInnerHTML={{ __html: event.title }}
      />
      <p className="mt-2 text-sm text-muted-foreground">
        {formatEventDateRange(event.startsAt, event.endsAt)}
      </p>
      <p className="text-sm text-muted-foreground">{event.location}</p>
      <p className="mt-4 text-sm whitespace-pre-line">{event.description}</p>

      {embedSrc && (
        <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-lg bg-muted">
          <iframe
            src={embedSrc}
            title={stripHtml(event.title)}
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {content && content.agenda.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Agenda</h2>
          <ol className="mt-3 space-y-4">
            {content.agenda.map((row, i) => (
              <li key={i} className="flex gap-4">
                <span className="w-20 shrink-0 text-sm font-medium text-muted-foreground">
                  {row.time}
                </span>
                <div>
                  <p className="text-sm font-medium">{row.title}</p>
                  {row.description && (
                    <p className="text-sm text-muted-foreground">{row.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {content && content.speakers.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Speakers</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {content.speakers.map((speaker, i) => (
              <Card key={i}>
                <CardContent className="flex gap-3">
                  <Avatar size="lg">
                    {speaker.imageUrl && <AvatarImage src={speaker.imageUrl} alt={speaker.name} />}
                    <AvatarFallback>{initials(speaker.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{speaker.name}</p>
                    {speaker.title && (
                      <p className="text-xs text-muted-foreground">{speaker.title}</p>
                    )}
                    {speaker.bio && (
                      <p className="mt-1 text-sm whitespace-pre-line">{speaker.bio}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {content && content.faqs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">FAQs</h2>
          <Accordion type="single" collapsible className="mt-3">
            {content.faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      <p className="mt-6 text-sm font-medium">
        {publicState.seatsTaken} of {publicState.capacity} spots taken
      </p>

      <div className="mt-6 max-w-sm">
        <RsvpForm
          slug={slug}
          isFull={isFull}
          ctaLabel={content?.ctaLabel}
          accentColor={brandColor}
        />
      </div>
    </div>
  );
}
