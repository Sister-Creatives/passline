import { cn } from "@/lib/utils";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

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
	return (
		<SidebarProvider
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
	);
}
