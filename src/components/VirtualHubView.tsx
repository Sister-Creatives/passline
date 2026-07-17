import { parseVideoEmbed } from "../../convex/lib/eventContent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shape shared by `virtualHub.getForOrder` and `virtualHub.getWithPassword`
 * (the F14 "public hub view" -- see convex/virtualHub.ts toPublicHubView).
 * Never includes `accessPassword`.
 */
export type VirtualHubViewData = {
  heading?: string;
  description?: string;
  videoUrl?: string;
  meetingUrl?: string;
  resources: { title: string; url: string }[];
};

/**
 * Renders a ticket holder's / password-gated visitor's view of an event's
 * virtual hub: an embedded video (via parseVideoEmbed -- the *only* source
 * for the iframe src, never an arbitrary URL), a "Join the meeting" button
 * (meetingUrl rendered as a plain href, target=_blank rel=noopener
 * noreferrer -- never script/iframe), and a list of resource links. Shared
 * by /orders/$token and /e/$slug/watch (F14 spec §5).
 */
export function VirtualHubView({ hub }: { hub: VirtualHubViewData }) {
  const embed = hub.videoUrl ? parseVideoEmbed(hub.videoUrl) : null;
  const embedSrc =
    embed?.provider === "youtube"
      ? `https://www.youtube.com/embed/${embed.id}`
      : embed?.provider === "vimeo"
        ? `https://player.vimeo.com/video/${embed.id}`
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hub.heading || "Virtual event"}</CardTitle>
        {hub.description && <CardDescription>{hub.description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {embedSrc && (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
            <iframe
              src={embedSrc}
              title={hub.heading || "Virtual event"}
              className="absolute inset-0 h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {hub.meetingUrl && (
          <Button asChild size="lg" className="w-fit">
            <a href={hub.meetingUrl} target="_blank" rel="noopener noreferrer">
              Join the meeting
            </a>
          </Button>
        )}

        {hub.resources.length > 0 && (
          <div>
            <h3 className="text-sm font-medium">Resources</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {hub.resources.map((resource, i) => (
                <li key={i}>
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary underline underline-offset-4 hover:no-underline"
                  >
                    {resource.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
