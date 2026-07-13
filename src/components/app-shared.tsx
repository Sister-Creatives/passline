import type { ReactNode } from "react";
import { LayoutDashboardIcon, CalendarIcon, SettingsIcon, UserIcon, CreditCardIcon, UsersIcon, PlugIcon } from "lucide-react";

export type SidebarNavItem = { title: string; path: string; icon?: ReactNode; isActive?: boolean };
export type SidebarNavGroup = { label: string; items: SidebarNavItem[] };

export const primaryNav: SidebarNavItem[] = [
	{ title: "Overview", path: "/dashboard", icon: <LayoutDashboardIcon /> },
	{ title: "Events", path: "/events", icon: <CalendarIcon /> },
];

export const settingsGroup = {
	title: "Settings",
	icon: <SettingsIcon />,
	items: [
		{ title: "Organization profile", path: "/settings/profile", icon: <UserIcon /> },
		{ title: "Payments", path: "/settings/payments", icon: <CreditCardIcon /> },
		{ title: "Team", path: "/settings/team", icon: <UsersIcon /> },
		{ title: "API & webhooks", path: "/settings/api-webhooks", icon: <PlugIcon /> },
	] satisfies SidebarNavItem[],
};

// Back-compat exports still referenced by app-header.tsx.
export const navGroups: SidebarNavGroup[] = [{ label: "Menu", items: primaryNav }];
export const navLinks: SidebarNavItem[] = [...primaryNav, ...settingsGroup.items];
