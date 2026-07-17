"use client";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { ChevronLeftIcon, LayoutDashboardIcon, DoorOpenIcon, ScanLineIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Contextual sub-nav shown while viewing a single event -- an "All events"
 * back-link plus Overview / Door / Scan for that event. Hooks can't be
 * conditional, so the route match happens here and the event-scoped query
 * lives in the inner component, which only mounts once we have an id.
 */
export function NavEventContext() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = pathname.match(/^\/events\/([^/]+)(?:\/(door|scan))?\/?$/);
  const eventId = match?.[1];
  if (!eventId || eventId === "new") return null;
  return <EventContextNav eventId={eventId as Id<"events">} pathname={pathname} />;
}

function EventContextNav({ eventId, pathname }: { eventId: Id<"events">; pathname: string }) {
  const { data: event } = useQuery(convexQuery(api.sidebar.getEventNav, { eventId }));
  const base = "/events/" + eventId;
  const items = [
    { title: "Overview", to: "/events/$id", exactActive: pathname === base, icon: <LayoutDashboardIcon /> },
    { title: "Door", to: "/events/$id/door", exactActive: pathname.endsWith("/door"), icon: <DoorOpenIcon /> },
    { title: "Scan", to: "/events/$id/scan", exactActive: pathname.endsWith("/scan"), icon: <ScanLineIcon /> },
  ];

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarMenu className="gap-1">
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground" tooltip="All events">
            <Link to="/events">
              <ChevronLeftIcon />
              <span>All events</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarGroupLabel className="mt-1 truncate">{event?.title ?? "Event"}</SidebarGroupLabel>
      <SidebarMenu className="gap-1">
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton asChild isActive={item.exactActive} tooltip={item.title}>
              <Link to={item.to} params={{ id: eventId }}>
                {item.icon}
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
