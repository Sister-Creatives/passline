"use client";

import { SearchIcon } from "lucide-react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useCommandPalette } from "@/components/command-palette";

/**
 * The sidebar's search entry point. It looks like an input (matching the app's
 * Input style) but is a button that opens the ⌘K command palette -- the palette
 * owns the actual search/navigation.
 */
export function AppSearch() {
	const { setOpen } = useCommandPalette();

	return (
		<button
			type="button"
			onClick={() => setOpen(true)}
			className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
		>
			<SearchIcon className="size-4 shrink-0" />
			<span>Search...</span>
			<KbdGroup className="ml-auto">
				<Kbd>⌘</Kbd>
				<Kbd>K</Kbd>
			</KbdGroup>
		</button>
	);
}
