import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { navLinks } from "@/components/app-shared";
import { CustomTrigger } from "@/components/custom-trigger";
import { HelpCircleIcon, BellIcon } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

export function AppHeader() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const activeItem =
		navLinks.find((item) => item.path === pathname) ??
		navLinks.find((item) => item.path !== "/dashboard" && pathname.startsWith(item.path));

	return (
		<header className="sticky top-0 z-50 flex h-(--app-header-height) w-full shrink-0 items-center justify-between gap-2 border-b bg-background px-4 md:px-6">
			<div className="flex items-center gap-3">
				<CustomTrigger place="navbar" />
			</div>
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbPage>{activeItem?.title ?? "Overview"}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>{" "}
			<div className="flex items-center gap-3">
				<Button size="icon-sm" variant="outline">
					<HelpCircleIcon
					/>
				</Button>
				<Button aria-label="Notifications" size="icon-sm" variant="outline">
					<BellIcon
					/>
				</Button>
			</div>
		</header>
	);
}
