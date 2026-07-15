"use client";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { ChevronRight, SearchIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { primaryNav, createAction, settingsGroup } from "@/components/app-shared";
import { api } from "../../convex/_generated/api";
import { AppSearch } from "@/components/app-search";
import { NavWorkspace } from "@/components/nav-workspace";
import { NavUser } from "@/components/nav-user";
import { NavLiveBanner } from "@/components/nav-live-banner";
import { NavEventContext } from "@/components/nav-event-context";
import { NavUpcomingEvents } from "@/components/nav-upcoming-events";
import { NavGettingStarted } from "@/components/nav-getting-started";
import { useCommandPalette } from "@/components/command-palette";

/** Compact count for badges: 1250 -> "1.2k", 12000 -> "12k". */
function formatCount(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpen: openPalette } = useCommandPalette();
  const { data: counts } = useQuery(convexQuery(api.organizers.getSidebarCounts, {}));
  const settingsOpen = settingsGroup.items.some((i) => pathname.startsWith(i.path));

  // Overview is only active on an exact match; every other section stays lit
  // for its whole subtree (e.g. Events for /events/$id).
  const isActive = (path: string) =>
    path === "/dashboard" ? pathname === path : pathname.startsWith(path);

  const badgeFor = (key?: "events" | "attendees") => {
    if (!key || !counts) return null;
    const value = counts[key];
    return value > 0 ? formatCount(value) : null;
  };

  return (
    <Sidebar collapsible="icon" variant="sidebar" className="group-data-[side=left]:border-r-0">
      {/* Workspace / org identity -- replaces the static "Passline" wordmark */}
      <SidebarHeader className="h-(--app-header-height,3rem) p-0">
        <NavWorkspace />
      </SidebarHeader>

      <SidebarContent>
        {/* Search: opens the ⌘K command palette. Full field when expanded, an
            icon button when collapsed. */}
        <SidebarGroup className="py-2 group-data-[collapsible=icon]:hidden">
          <AppSearch />
        </SidebarGroup>
        <SidebarGroup className="hidden py-2 group-data-[collapsible=icon]:block">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Search" onClick={() => openPalette(true)}>
                <SearchIcon />
                <span>Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Prominent create action -- uses the shared tactile Button style */}
        <SidebarGroup className="py-0">
          <Button
            asChild
            className="w-full group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!"
          >
            <Link to={createAction.path} aria-label={createAction.title}>
              {createAction.icon}
              <span className="group-data-[collapsible=icon]:hidden">{createAction.title}</span>
            </Link>
          </Button>
        </SidebarGroup>

        {/* Live now -- only renders when an event is in progress */}
        <NavLiveBanner />

        {/* Contextual event sub-nav -- only renders while viewing an event */}
        <NavEventContext />

        {/* Manage group */}
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {primaryNav.map((item) => {
              const badge = badgeFor(item.badgeKey);
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={item.title}>
                    <Link to={item.path}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {badge && (
                    <SidebarMenuBadge className="rounded-full bg-sidebar-border px-1.5 font-medium text-sidebar-foreground/70">
                      {badge}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        {/* Upcoming events quick-jump -- only renders when there are any */}
        <NavUpcomingEvents />

        {/* Settings group (collapsible, animated) */}
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            <Collapsible defaultOpen={settingsOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={settingsGroup.title}>
                    {settingsGroup.icon}
                    <span>{settingsGroup.title}</span>
                    <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
                  <SidebarMenuSub>
                    {settingsGroup.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.path}>
                        <SidebarMenuSubButton asChild isActive={pathname.startsWith(sub.path)}>
                          <Link to={sub.path}>
                            {sub.icon}
                            <span>{sub.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          </SidebarMenu>
        </SidebarGroup>

        {/* Getting-started checklist -- only renders until it's complete */}
        <NavGettingStarted />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
