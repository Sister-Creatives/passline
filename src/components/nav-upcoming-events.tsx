"use client";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { format } from "date-fns";

import { api } from "../../convex/_generated/api";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavUpcomingEvents() {
  const { data: events } = useQuery(convexQuery(api.sidebar.getUpcomingEvents, {}));

  if (!events || events.length === 0) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Upcoming</SidebarGroupLabel>
      <SidebarMenu className="gap-1">
        {events.map((e) => (
          <SidebarMenuItem key={e._id}>
            <SidebarMenuButton asChild tooltip={e.title}>
              <Link to="/events/$id" params={{ id: e._id }}>
                <span className="truncate">{e.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {format(new Date(e.startsAt), "MMM d")}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
