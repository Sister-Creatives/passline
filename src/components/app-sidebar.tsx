"use client";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { primaryNav, createAction, settingsGroup } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";
import { LogoIcon } from "@/components/logo";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settingsOpen = settingsGroup.items.some((i) => pathname.startsWith(i.path));

  // Overview is only active on an exact match; every other section stays lit
  // for its whole subtree (e.g. Events for /events/$id).
  const isActive = (path: string) =>
    path === "/dashboard" ? pathname === path : pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="h-(--app-header-height,3rem) flex-row items-center gap-2 px-3">
        <LogoIcon className="size-5 shrink-0 text-primary" />
        <span className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
          Passline
        </span>
      </SidebarHeader>

      <SidebarContent>
        {/* Prominent create action */}
        <SidebarGroup className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={createAction.title}
                className="bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
              >
                <Link to={createAction.path}>
                  {createAction.icon}
                  <span>{createAction.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Manage group */}
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarMenu>
            {primaryNav.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={item.title}>
                  <Link to={item.path}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Settings group (collapsible) */}
        <SidebarGroup>
          <SidebarMenu>
            <Collapsible defaultOpen={settingsOpen} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={settingsGroup.title}>
                    {settingsGroup.icon}
                    <span>{settingsGroup.title}</span>
                    <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {settingsGroup.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.path}>
                        <SidebarMenuSubButton asChild isActive={pathname.startsWith(sub.path)}>
                          <Link to={sub.path}>
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
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
