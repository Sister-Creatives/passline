"use client";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { CalendarIcon, MapPinIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatEventDateRange } from "@/lib/format-event-date";
import { Iphone } from "@/components/ui/iphone";

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
 * A phone-framed (Magic UI Iphone) preview of the public event page, shown on
 * the right of the event editor. It reads the same event doc + page content the
 * public page does, so it reflects edits as soon as they're saved (the Convex
 * queries are reactive). Drafts can't be viewed at their public URL, which is
 * why this renders the content into the frame rather than iframing the page.
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
    <aside className="hidden w-[300px] shrink-0 2xl:block">
      {/* top-16 clears the 3rem sticky app header so the phone doesn't slide under it */}
      <div className="sticky top-16">
        <Iphone className="w-full">
          <div className="min-h-full bg-background text-foreground">
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
                className="text-base leading-tight font-semibold"
                style={brand ? { color: brand } : undefined}
              >
                {title}
              </h1>

              <div className="space-y-1.5 text-[13px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <CalendarIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>{dateRange}</span>
                </div>
                {event.location && (
                  <div className="flex items-start gap-2">
                    <MapPinIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>{event.location}</span>
                  </div>
                )}
              </div>

              {description && (
                <p className="text-[13px] whitespace-pre-wrap text-foreground/80">{description}</p>
              )}

              <button
                type="button"
                disabled
                className="mt-1 w-full rounded-lg py-2.5 text-sm font-medium"
                style={{
                  background: brand ?? "var(--primary)",
                  color: brand ? "#fff" : "var(--primary-foreground)",
                }}
              >
                {cta}
              </button>
            </div>
          </div>
        </Iphone>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Live preview · how attendees see it
        </p>
      </div>
    </aside>
  );
}
