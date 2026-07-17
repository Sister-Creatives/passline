import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPaletteProvider } from "@/components/command-palette";

/** Reads the collapse state SidebarProvider persists to a cookie on every toggle. */
function readSidebarCookie(): boolean | undefined {
	if (typeof document === "undefined") return undefined;
	const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
	return match ? match[1] === "true" : undefined;
}

// AppShell is mounted per-route (there's no shared layout route), so it remounts
// on every top-level navigation. This flag flips true after the first client
// render so those remounts seed `open` from the cookie synchronously and don't
// flash. Only the very first hydration paint must match the server (open); it's
// corrected once by the mount effect. Never set on the server (effects don't run
// there), so SSR always renders the neutral `open` state.
let hasHydrated = false;

export function AppShell({
	children,
	wide = false,
}: {
	children: React.ReactNode;
	// `wide` lets a workspace-style page (the event editor) fill the whole
	// content area instead of the centered 80rem document column, and manage
	// its own padding. Default pages stay centered + padded.
	wide?: boolean;
}) {
	// Controlled so the collapse state survives reloads and client navigations.
	// On the first hydration paint we must render the neutral `open` state to
	// match the server; after that, remounts read the cookie synchronously (no
	// flash). SidebarProvider still writes the cookie and handles Cmd/Ctrl+B.
	const [open, setOpen] = useState(() =>
		hasHydrated ? (readSidebarCookie() ?? true) : true
	);
	useEffect(() => {
		hasHydrated = true;
		const saved = readSidebarCookie();
		if (saved !== undefined) setOpen(saved);
	}, []);

	return (
		<CommandPaletteProvider>
			<SidebarProvider
				open={open}
				onOpenChange={setOpen}
				className={cn(
					"[--app-wrapper-max-width:80rem]",
					"[--app-header-height:3rem]"
				)}
			>
				<AppSidebar />
				<SidebarInset className="bg-muted dark:bg-background">
					<AppHeader />
					<div
						className={cn(
							"flex flex-1 flex-col",
							wide
								? "w-full"
								: "mx-auto w-full max-w-(--app-wrapper-max-width) p-4 md:p-6"
						)}
					>
						{children}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</CommandPaletteProvider>
	);
}
