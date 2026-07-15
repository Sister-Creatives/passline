"use client";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { DoorOpenIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function NavLiveBanner() {
  const { data: live } = useQuery(convexQuery(api.sidebar.getLiveEvents, {}));

  if (!live || live.length === 0) return null;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>
        <span className="relative mr-2 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        Live now
      </SidebarGroupLabel>
      <SidebarMenu className="gap-1">
        {live.map((e) => (
          <SidebarMenuItem key={e._id}>
            <SidebarMenuButton asChild tooltip={e.title + " — at the door"}>
              <Link to="/events/$id/door" params={{ id: e._id }}>
                <DoorOpenIcon />
                <span className="truncate">{e.title}</span>
              </Link>
            </SidebarMenuButton>
            {e.checkedIn > 0 && (
              <SidebarMenuBadge className="rounded-full bg-sidebar-border px-1.5 font-medium text-sidebar-foreground/70">
                {e.checkedIn}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
