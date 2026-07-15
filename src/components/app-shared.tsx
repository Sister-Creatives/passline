import type { ReactNode } from "react";
import {
  LayoutDashboardIcon,
  CalendarIcon,
  UsersRoundIcon,
  ChartColumnIcon,
  MegaphoneIcon,
  SettingsIcon,
  UserIcon,
  CreditCardIcon,
  UsersIcon,
  PlugIcon,
  PlusIcon,
  IdCardIcon,
} from "lucide-react";

export type SidebarNavItem = { title: string; path: string; icon?: ReactNode; isActive?: boolean };
export type SidebarNavGroup = { label: string; items: SidebarNavItem[] };

// Primary create action -- rendered as a prominent button above the nav.
export const createAction: SidebarNavItem = {
  title: "Create event",
  path: "/events/new",
  icon: <PlusIcon />,
};

// The organizer's day-to-day sections (the "Manage" group).
export const primaryNav: SidebarNavItem[] = [
  { title: "Overview", path: "/dashboard", icon: <LayoutDashboardIcon /> },
  { title: "Events", path: "/events", icon: <CalendarIcon /> },
  { title: "Attendees", path: "/attendees", icon: <UsersRoundIcon /> },
  { title: "Reports", path: "/reports", icon: <ChartColumnIcon /> },
  { title: "Marketing", path: "/marketing", icon: <MegaphoneIcon /> },
];

export const settingsGroup = {
  title: "Settings",
  icon: <SettingsIcon />,
  items: [
    { title: "Organization profile", path: "/settings/profile", icon: <UserIcon /> },
    { title: "Payments", path: "/settings/payments", icon: <CreditCardIcon /> },
    { title: "Team", path: "/settings/team", icon: <UsersIcon /> },
    { title: "Host profiles", path: "/settings/host-profiles", icon: <IdCardIcon /> },
    { title: "API & webhooks", path: "/settings/api-webhooks", icon: <PlugIcon /> },
  ] satisfies SidebarNavItem[],
};

// Back-compat exports still referenced by app-header.tsx (breadcrumb lookup).
export const navGroups: SidebarNavGroup[] = [{ label: "Manage", items: primaryNav }];
export const navLinks: SidebarNavItem[] = [createAction, ...primaryNav, ...settingsGroup.items];
