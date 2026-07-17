"use client";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

type Place = "sidebar" | "navbar";

export function CustomTrigger({ place }: { place: Place }) {
	const isMobile = useIsMobile();
	const { open, openMobile } = useSidebar();
	const sidebarOpen = isMobile ? openMobile : open;

	return (
		<SidebarTrigger
			className={cn(
				"transition-opacity duration-200 ease-out",
				// The navbar trigger stays visible in both states so there's always an
				// obvious toggle. The sidebar-placed variant (unused now that
				// SidebarRail owns the edge-collapse affordance) fades with state.
				place === "sidebar" &&
					!sidebarOpen &&
					"pointer-events-none opacity-0"
			)}
		/>
	);
}
