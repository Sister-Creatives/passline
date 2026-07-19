import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Check, CircleAlert, Circle, ChevronRight, Copy, Dot, ExternalLink, Eye, RotateCcw } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EVENT_SECTION_GROUPS, EVENT_SECTIONS, type EventSectionKey } from "@/lib/eventSections";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type SectionStatus = "complete" | "warning" | "incomplete";

function StatusGlyph({ status }: { status: SectionStatus | undefined }) {
  if (status === "complete") return <Check className="size-4 text-success" role="img" aria-label="Complete" />;
  if (status === "warning") return <CircleAlert className="size-4 text-warning" role="img" aria-label="Has suggestions" />;
  if (status === "incomplete") return <Circle className="size-4 text-muted-foreground" role="img" aria-label="Incomplete" />;
  return <Dot className="size-4 text-muted-foreground/50" aria-hidden />;
}

export function EventBuilderNav({
  eventId, activeSection, isPublished, slug, previewToken, onTogglePublish,
}: {
  eventId: Id<"events">;
  activeSection: EventSectionKey;
  isPublished: boolean;
  slug: string;
  previewToken?: string;
  onTogglePublish: () => void;
}) {
  const { data: readiness } = useQuery(convexQuery(api.events.getEventReadiness, { eventId }));
  const sectionStatus = readiness?.sectionStatus ?? {};
  const blockers = (readiness?.rules ?? []).filter((r) => r.severity === "required" && r.status === "fail");
  const suggestions = (readiness?.rules ?? []).filter((r) => r.severity === "recommended" && r.status === "fail");

  const groups = EVENT_SECTION_GROUPS.map((group) => ({
    ...group,
    items: EVENT_SECTIONS.filter((s) => s.group === group.key),
  }));

  const ensurePreview = useMutation(api.events.ensurePreviewToken);
  const rotatePreview = useMutation(api.events.rotatePreviewToken);
  const [previewBusy, setPreviewBusy] = useState(false);

  async function createPreview() {
    setPreviewBusy(true);
    try {
      await ensurePreview({ eventId });
      toast.success("Preview link ready");
    } catch {
      toast.error("Couldn't create the preview link");
    } finally {
      setPreviewBusy(false);
    }
  }
  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/e/${slug}?preview=${previewToken}`);
      toast.success("Preview link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  }
  async function resetPreview() {
    try {
      await rotatePreview({ eventId });
      toast.success("Preview link reset — the old link no longer works");
    } catch {
      toast.error("Couldn't reset the link");
    }
  }

  return (
    <nav className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-(--app-header-height) lg:max-h-[calc(100svh-var(--app-header-height))] lg:w-60 lg:self-start lg:overflow-y-auto lg:pt-1 lg:pb-4">
      {groups.map((group) => {
        const defaultOpen =
          group.key === "edit"
            ? true
            : group.items.some((s) => s.key === activeSection);
        return (
          <Collapsible key={group.key} defaultOpen={defaultOpen} className="group/collapsible">
            <CollapsibleTrigger className="flex h-8 w-full items-center justify-between rounded-md px-2 text-xs font-medium uppercase text-muted-foreground hover:bg-accent">
              <span>{group.label}</span>
              <ChevronRight className="size-3.5 transition-transform duration-200 ease-out group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up motion-reduce:animate-none">
              <div className="flex flex-col pt-1">
                {group.items.map((s) => (
                  <Link
                    key={s.key}
                    to="/events/$id"
                    params={{ id: eventId }}
                    search={{ section: s.key }}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                      s.key === activeSection && "bg-accent font-medium",
                    )}
                  >
                    {group.key === "edit" ? <StatusGlyph status={sectionStatus[s.key]} /> : null}
                    <span>{s.label}</span>
                  </Link>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      <div className="mt-2 rounded-lg border p-3">
        {readiness === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="text-sm font-medium">
              Ready {readiness.requiredPassing}/{readiness.requiredTotal}
            </div>
            {blockers.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {blockers.map((b) => (
                  <li key={b.id}>
                    &bull;{" "}
                    <Link
                      to="/events/$id"
                      params={{ id: eventId }}
                      search={{ section: b.section }}
                      className="hover:underline"
                    >
                      {b.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {blockers.length === 0 && suggestions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    Suggested:{" "}
                    <Link
                      to="/events/$id"
                      params={{ id: eventId }}
                      search={{ section: s.section }}
                      className="hover:underline"
                    >
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!isPublished && !readiness.canPublish ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mt-3 block">
                    <Button
                      className="w-full"
                      variant="default"
                      disabled
                    >
                      Publish
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {blockers.map((b) => b.label).join("; ")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                className="mt-3 w-full"
                variant={isPublished ? "outline" : "default"}
                onClick={onTogglePublish}
              >
                {isPublished ? "Unpublish" : "Publish"}
              </Button>
            )}
            {isPublished && (
              <Button asChild variant="link" size="sm" className="mt-1 w-full">
                <a href={`/e/${slug}`} target="_blank" rel="noreferrer">
                  View page <ExternalLink className="size-3" />
                </a>
              </Button>
            )}
            {!isPublished && (
              <div className="mt-3 space-y-1.5 border-t pt-3">
                {previewToken ? (
                  <>
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <a href={`/e/${slug}?preview=${previewToken}`} target="_blank" rel="noreferrer">
                        <Eye className="size-3.5" /> Open preview
                      </a>
                    </Button>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="flex-1" onClick={copyPreview}>
                        <Copy className="size-3.5" /> Copy link
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Reset preview link">
                            <RotateCcw className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reset the preview link?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A new link is generated and the current one stops working for anyone
                              you&apos;ve shared it with.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={resetPreview}>Reset link</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={createPreview}
                    disabled={previewBusy}
                  >
                    <Eye className="size-3.5" /> Create preview link
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Share a private link to this draft before you publish.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </nav>
  );
}
