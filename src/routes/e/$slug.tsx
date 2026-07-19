import { Suspense } from "react";
import type { CSSProperties } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Eye } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { isValidHexColor, parseVideoEmbed } from "../../../convex/lib/eventContent";
import { ACCESSIBILITY_FEATURES } from "@/lib/accessibility";
import { Checkout } from "@/components/Checkout";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

// PUBLIC route: no AuthGuard. Anyone with the link can view a published
// event and RSVP -- this is the attendee-facing surface, not the organizer's.
export const Route = createFileRoute("/e/$slug")({
  // `?preview=<token>` opens a draft's public page for anyone with the link
  // (see convex/lib/preview.ts). Absent → behaves exactly as before.
  validateSearch: (search: Record<string, unknown>): { preview?: string } => ({
    preview: typeof search.preview === "string" ? search.preview : undefined,
  }),
  loaderDeps: ({ search }) => ({ preview: search.preview }),
  // Prefetch the event for SSR/SEO: the crawler/first paint gets real HTML
  // instead of a loading state, and useSuspenseQuery below reads the same
  // cached entry so there's no duplicate fetch on hydration. The loader
  // also returns the event so `head` below can build a per-event <title>.
  loader: async ({ params, context, deps }) => {
    const event = await context.queryClient.ensureQueryData(
      convexQuery(api.events.getEventBySlug, {
        slug: params.slug,
        previewToken: deps.preview,
      }),
    );
    return { event };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.event
          ? `${stripHtml(loaderData.event.title)} · Passline`
          : "Event · Passline",
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
  const { preview } = Route.useSearch();
  const { data: event } = useSuspenseQuery(
    convexQuery(api.events.getEventBySlug, { slug, previewToken: preview }),
  );

  if (!event) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-4 text-center">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Event not found</EmptyTitle>
            <EmptyDescription>
              This event does not exist or is no longer published.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return <EventDetails slug={slug} event={event} previewToken={preview} />;
}

// eventContent.getBySlug returns either the real doc or a plain "empty
// defaults" object (see convex/eventContent.ts emptyContent()) -- those two
// shapes only structurally share the array fields, so this normalizes both
// into one friendly optional-fields shape for the JSX below instead of
// accessing the raw union everywhere.
type PublicEventContent = {
  coverImageUrl?: string;
  coverImageAlt?: string;
  gallery?: { url: string; alt?: string }[];
  brandColor?: string;
  ctaLabel?: string;
  videoUrl?: string;
  agenda: Doc<"eventContent">["agenda"];
  speakers: Doc<"eventContent">["speakers"];
  faqs: Doc<"eventContent">["faqs"];
  accessibility?: Doc<"eventContent">["accessibility"];
};

function EventDetails({
  slug,
  event,
  previewToken,
}: {
  slug: string;
  event: Doc<"events">;
  previewToken?: string;
}) {
  // Separate hook, separate component: keeps this query out of the branch
  // above so hook order never depends on whether the event was found.
  const { data: publicState } = useSuspenseQuery(
    convexQuery(api.rsvps.getEventPublicState, { slug, previewToken }),
  );
  const { data: rawContent } = useSuspenseQuery(
    convexQuery(api.eventContent.getBySlug, { slug, previewToken }),
  );
  const { data: ticketTypes } = useSuspenseQuery(
    convexQuery(api.ticketTypes.listPublicForEvent, { eventId: event._id, previewToken }),
  );
  const { data: host } = useSuspenseQuery(
    convexQuery(api.hostProfiles.getForEvent, { eventId: event._id, previewToken }),
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

  const accessibility = content?.accessibility;
  const enabledAccessibilityFeatures = ACCESSIBILITY_FEATURES.filter(
    ({ key }) => accessibility?.[key],
  );
  const accessibilityNotes = accessibility?.notes;
  const hasAccessibilityInfo = enabledAccessibilityFeatures.length > 0 || !!accessibilityNotes;

  // Header CTA scrolls to the ticket/RSVP section rather than repeating the form.
  const headerCta =
    ticketTypes.length > 0
      ? "Get tickets"
      : isFull
        ? "Join the waitlist"
        : (content?.ctaLabel ?? "RSVP");
  const remaining = Math.max(0, publicState.capacity - publicState.seatsTaken);
  const takenPct =
    publicState.capacity > 0
      ? Math.min(100, (publicState.seatsTaken / publicState.capacity) * 100)
      : 0;

  return (
    <div style={brandColor ? ({ "--brand": brandColor } as CSSProperties) : undefined}>
      {event.status !== "published" ? (
        <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-700 dark:text-amber-400">
          <Eye className="size-3.5 shrink-0" />
          <span>Preview — this event isn&apos;t published yet. Only people with this link can see it.</span>
        </div>
      ) : null}
      {/* Translucent sticky chrome: a persistent home link + CTA so the page
          is never a wayfinding dead-end and tickets are always one tap away. */}
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4 sm:px-8">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Passline
          </Link>
          <Button asChild size="sm">
            <a href="#get-tickets">{headerCta}</a>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <TrackingPixels
          metaPixelId={event.metaPixelId}
          googleAnalyticsId={event.googleAnalyticsId}
          gtmId={event.gtmId}
        />

        {content?.coverImageUrl && (
          <div className="mb-6 overflow-hidden rounded-2xl shadow-sm ring-1 ring-border/60">
            <img
              src={content.coverImageUrl}
              alt={content.coverImageAlt || stripHtml(event.title)}
              loading="lazy"
              className="max-h-80 w-full max-w-full object-cover"
            />
          </div>
        )}

        {/* Brand colour used as a safe accent rule, never as the title text
            colour (arbitrary organizer hex fails contrast on the page bg). */}
        {brandColor && (
          <div className="mb-3 h-1 w-12 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
        )}
        {/* Authors may embed inline <i>/<em>/<br>/<strong> in the title. */}
        <h1
          className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          dangerouslySetInnerHTML={{ __html: event.title }}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          {formatEventDateRange(event.startsAt, event.endsAt)}
        </p>
        <p className="text-sm text-muted-foreground">{event.location}</p>
        <p className="mt-4 text-sm whitespace-pre-line">{event.description}</p>

      {content && content.gallery && content.gallery.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Gallery</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {content.gallery.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={img.alt || `${stripHtml(event.title)} photo ${i + 1}`}
                loading="lazy"
                className="aspect-square w-full rounded-lg object-cover ring-1 ring-border/60"
              />
            ))}
          </div>
        </section>
      )}

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

      {hasAccessibilityInfo && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Accessibility</h2>
          {enabledAccessibilityFeatures.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {enabledAccessibilityFeatures.map(({ key, label, icon: Icon }) => (
                <li key={key}>
                  <Badge variant="outline">
                    <Icon />
                    {label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {accessibilityNotes && (
            <p className="mt-3 text-sm whitespace-pre-line">{accessibilityNotes}</p>
          )}
        </section>
      )}

      {host && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Hosted by</h2>
          <Card className="mt-3">
            <CardContent className="flex gap-3">
              <Avatar size="lg">
                {host.logoUrl && <AvatarImage src={host.logoUrl} alt={host.name} />}
                <AvatarFallback>{initials(host.name)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{host.name}</p>
                {host.bio && <p className="mt-1 text-sm whitespace-pre-line">{host.bio}</p>}
                {host.websiteUrl && (
                  <a
                    href={host.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-sm text-muted-foreground underline"
                  >
                    {host.websiteUrl}
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

        {/* Scarcity is the product's emotional hook — render it as a live
            meter, not a line of grey text. The fill eases as seats sell
            (the query is reactive), and turns destructive at capacity. */}
        <div className="mt-8">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {isFull
                ? "Sold out"
                : `${remaining} spot${remaining === 1 ? "" : "s"} left`}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {publicState.seatsTaken} / {publicState.capacity}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
              style={{
                width: `${takenPct}%`,
                backgroundColor: isFull ? "var(--destructive)" : (brandColor ?? "var(--primary)"),
              }}
            />
          </div>
        </div>

        <div id="get-tickets" className="mt-6 scroll-mt-20">
          {ticketTypes.length > 0 ? (
            <Checkout event={event} />
          ) : (
            <div className="max-w-sm">
              <RsvpForm
                slug={slug}
                isFull={isFull}
                ctaLabel={content?.ctaLabel}
                accentColor={brandColor}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
