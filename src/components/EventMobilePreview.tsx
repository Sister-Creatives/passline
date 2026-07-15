"use client";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { CalendarIcon, MapPinIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatEventDateRange } from "@/lib/format-event-date";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Strip the inline markup titles/descriptions may carry, for a clean preview. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

type PreviewEvent = {
  _id: Id<"events">;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  location: string;
};

/**
 * A phone-framed preview of the public event page, shown on the right of the
 * event editor. It reads the same event doc + page content the public page
 * does, so it reflects edits as soon as they're saved (the Convex queries are
 * reactive). Drafts can't be viewed at their public URL, which is why this is a
 * component render rather than an iframe.
 */
export function EventMobilePreview({ event }: { event: PreviewEvent }) {
  const { data } = useQuery(convexQuery(api.eventContent.get, { eventId: event._id }));
  // `get` returns either the page-content doc or an empty fallback lacking these
  // optional fields; narrow to the fields the preview reads.
  const content = data as
    | { coverImageUrl?: string; brandColor?: string; ctaLabel?: string }
    | undefined;

  const brand =
    content?.brandColor && HEX.test(content.brandColor) ? content.brandColor : undefined;
  const cover = content?.coverImageUrl;
  const cta = content?.ctaLabel?.trim() || "Get tickets";
  const title = stripTags(event.title).trim() || "Untitled event";
  const description = stripTags(event.description).trim();
  const dateRange = formatEventDateRange(event.startsAt, event.endsAt);

  return (
    <aside className="hidden w-[320px] shrink-0 2xl:block">
      <div className="sticky top-6">
        <div className="mx-auto w-[300px] rounded-[2.25rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl dark:border-neutral-700 dark:bg-neutral-700">
          <div className="relative h-[600px] overflow-hidden rounded-[1.5rem] bg-background">
            {/* notch */}
            <div className="pointer-events-none absolute top-0 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-neutral-900 dark:bg-neutral-700" />

            <div className="h-full overflow-y-auto">
              {/* cover */}
              {cover ? (
                <img src={cover} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div
                  className="aspect-video w-full bg-gradient-to-br from-muted to-muted-foreground/20"
                  style={
                    brand
                      ? { backgroundImage: `linear-gradient(135deg, ${brand}, ${brand}33)` }
                      : undefined
                  }
                />
              )}

              <div className="space-y-3 p-4">
                <h1
                  className="text-lg leading-tight font-semibold"
                  style={brand ? { color: brand } : undefined}
                >
                  {title}
                </h1>

                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <CalendarIcon className="mt-0.5 size-4 shrink-0" />
                    <span>{dateRange}</span>
                  </div>
                  {event.location && (
                    <div className="flex items-start gap-2">
                      <MapPinIcon className="mt-0.5 size-4 shrink-0" />
                      <span>{event.location}</span>
                    </div>
                  )}
                </div>

                {description && (
                  <p className="text-sm whitespace-pre-wrap text-foreground/80">{description}</p>
                )}

                <button
                  type="button"
                  disabled
                  className="mt-2 w-full rounded-lg py-2.5 text-sm font-medium"
                  style={{
                    background: brand ?? "var(--primary)",
                    color: brand ? "#fff" : "var(--primary-foreground)",
                  }}
                >
                  {cta}
                </button>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Live preview · how attendees see it
        </p>
      </div>
    </aside>
  );
}
