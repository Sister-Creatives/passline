import { Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatEventDateRange } from "@/lib/format-event-date";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

// PUBLIC route: no AuthGuard. A host's public directory of published events
// -- anyone with the link can browse it, mirroring /e/$slug's public surface.
//
// errorComponent covers a malformed/wrong-table organizerId: the
// `v.id("organizers")` arg validator throws server-side before
// getPublicProfile ever gets a chance to return null, so that case is caught
// here rather than by the null-profile branch below. Both render the same
// HostNotFound state so a malformed id and a valid-but-missing id look
// identical to the visitor.
export const Route = createFileRoute("/host/$organizerId")({
  component: HostDirectoryPage,
  errorComponent: HostNotFound,
});

// Initials for the host avatar's fallback (first letter of up to the first
// two whitespace-separated words of their name). Mirrors /e/$slug's speaker
// avatar fallback.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function HostDirectoryPage() {
  const { organizerId } = Route.useParams();
  return (
    <Suspense fallback={<HostDirectorySkeleton />}>
      <HostDirectoryContent organizerId={organizerId as Id<"organizers">} />
    </Suspense>
  );
}

function HostDirectorySkeleton() {
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-7 w-48" />
      </div>
      <Skeleton className="mt-8 h-5 w-32" />
      <div className="mt-3 grid gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

// Shared "not found" state for a host that doesn't exist -- rendered both
// when getPublicProfile resolves to null (valid id, no such organizer) and
// as the route's errorComponent (malformed/wrong-table id, which fails the
// `v.id("organizers")` arg validator before the query ever runs).
function HostNotFound() {
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Host not found</EmptyTitle>
          <EmptyDescription>This host doesn't exist or is no longer available.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

type PublishedEvent = {
  id: Id<"events">;
  title: string;
  slug: string;
  startsAt: number;
  endsAt: number;
  location: string;
};

function HostDirectoryContent({ organizerId }: { organizerId: Id<"organizers"> }) {
  // getPublicProfile returns null for an unknown id rather than throwing --
  // render an explicit "not found" state instead of a blank page.
  const { data: profile } = useSuspenseQuery(
    convexQuery(api.organizers.getPublicProfile, { organizerId }),
  );
  const { data: events } = useSuspenseQuery(
    convexQuery(api.events.listPublishedByOrganizer, { organizerId }),
  );

  if (!profile) {
    return <HostNotFound />;
  }

  const now = Date.now();
  const upcoming = events.filter((event) => event.endsAt >= now);
  const past = events.filter((event) => event.endsAt < now);

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <Avatar size="lg">
          {profile.image && <AvatarImage src={profile.image} alt={profile.name} />}
          <AvatarFallback>{initials(profile.name)}</AvatarFallback>
        </Avatar>
        <h1 className="text-2xl font-semibold sm:text-3xl">{profile.name}</h1>
      </div>

      {events.length === 0 ? (
        <Empty className="mt-8">
          <EmptyHeader>
            <EmptyTitle>No events yet</EmptyTitle>
            <EmptyDescription>This host hasn't published any events.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <EventSection title="Upcoming" events={upcoming} emptyMessage="No upcoming events." />
          <EventSection title="Past" events={past} emptyMessage="No past events." />
        </>
      )}
    </div>
  );
}

function EventSection({
  title,
  events,
  emptyMessage,
}: {
  title: string;
  events: PublishedEvent[];
  emptyMessage: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {events.map((event) => (
            <Link
              key={event.id}
              to="/e/$slug"
              params={{ slug: event.slug }}
              className="transition hover:opacity-80"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{event.title}</CardTitle>
                  <CardDescription>
                    {formatEventDateRange(event.startsAt, event.endsAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {event.location}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
