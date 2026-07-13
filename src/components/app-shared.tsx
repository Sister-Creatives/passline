import type { ReactNode } from "react";
import { LayoutDashboardIcon, MousePointerClickIcon, FunnelIcon, RepeatIcon, GitBranchIcon, UsersIcon, ChartPieIcon, UserIcon, PlugIcon } from "lucide-react";

export type SidebarNavItem = {
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label: string;
	items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
	{
		label: "Explore",
		items: [
			{
				title: "Dashboard",
				path: "#/overview",
				icon: (
					<LayoutDashboardIcon
					/>
				),
				isActive: true,
			},
			{
				title: "Events",
				path: "#/events",
				icon: (
					<MousePointerClickIcon
					/>
				),
			},
			{
				title: "Funnels",
				path: "#/funnels",
				icon: (
					<FunnelIcon
					/>
				),
			},
			{
				title: "Retention",
				path: "#/retention",
				icon: (
					<RepeatIcon
					/>
				),
			},
			{
				title: "Flows",
				path: "#/flows",
				icon: (
					<GitBranchIcon
					/>
				),
			},
		],
	},
	{
		label: "Audiences",
		items: [
			{
				title: "Segments",
				path: "#/segments",
				icon: (
					<UsersIcon
					/>
				),
			},
			{
				title: "Cohorts",
				path: "#/cohorts",
				icon: (
					<ChartPieIcon
					/>
				),
			},
			{
				title: "Profiles",
				path: "#/profiles",
				icon: (
					<UserIcon
					/>
				),
			},
		],
	},
	{
		label: "Configure",
		items: [
			{
				title: "Integrations",
				path: "#/integrations",
				icon: (
					<PlugIcon
					/>
				),
			},
		],
	},
];

export const navLinks: SidebarNavItem[] = [
	...navGroups.flatMap((group) =>
		group.items.flatMap((item) =>
			item.subItems?.length ? [item, ...item.subItems] : [item]
		)
	),
];
