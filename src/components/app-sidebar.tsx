"use client";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub,
  SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { primaryNav, settingsGroup } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const settingsOpen = settingsGroup.items.some((i) => pathname.startsWith(i.path));

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="h-(--app-header-height,3rem) flex-row items-center px-3">
        <span className="font-semibold">Passline</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {primaryNav.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={pathname === item.path} tooltip={item.title}>
                  <Link to={item.path}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}

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
