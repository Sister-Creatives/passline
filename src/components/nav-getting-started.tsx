"use client";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { SidebarGroup } from "@/components/ui/sidebar";

export function NavGettingStarted() {
  const { data } = useQuery(convexQuery(api.sidebar.getGettingStarted, {}));

  if (!data) return null;

  const steps = [
    { label: "Create your first event", to: "/events/new", complete: data.createdEvent },
    { label: "Publish an event", to: "/events", complete: data.publishedEvent },
    { label: "Make your first sale", to: "/events", complete: data.firstSale },
  ];
  const done = steps.filter((s) => s.complete).length;
  const total = steps.length;

  if (done === total) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <div className="rounded-lg border bg-sidebar-accent/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Getting started</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{total}
          </span>
        </div>
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: (done / total) * 100 + "%" }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {steps.map((step) =>
            step.complete ? (
              <div
                key={step.label}
                className="flex items-center gap-2 text-sm text-muted-foreground line-through"
              >
                <CheckCircle2Icon className="size-4 shrink-0 text-success" />
                <span className="truncate">{step.label}</span>
              </div>
            ) : (
              <Link
                key={step.label}
                to={step.to}
                className="flex items-center gap-2 rounded-md text-sm transition-colors hover:text-foreground"
              >
                <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{step.label}</span>
              </Link>
            )
          )}
        </div>
      </div>
    </SidebarGroup>
  );
}
