"use client";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { ChevronsUpDownIcon, UserIcon, UsersIcon, CreditCardIcon } from "lucide-react";

import { api } from "../../convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The workspace identity block at the top of the sidebar: the organizer's logo
 * and name, standing in for the old static "Passline" wordmark so the sidebar
 * reads as *their* workspace. Since there is a single `organizers` identity
 * (no multi-org in the schema), this is an org-admin menu, not a switcher --
 * the footer `NavUser` owns the personal/session menu.
 */
export function NavWorkspace() {
  const { data: me, isPending } = useQuery(convexQuery(api.organizers.getMe, {}));
  const { isMobile } = useSidebar();

  if (isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex h-full items-center gap-2 px-3">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-28 group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const name = me?.name ?? "Organizer";
  const initial = name.charAt(0).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={name}
              className="h-full rounded-none px-3 group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                {me?.image ? (
                  <img src={me.image} alt="" className="size-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold tracking-tight">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Organizer workspace
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="w-56"
          >
            <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to="/settings/profile">
                  <UserIcon />
                  Organization profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to="/settings/team">
                  <UsersIcon />
                  Team
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to="/settings/payments">
                  <CreditCardIcon />
                  Billing
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
