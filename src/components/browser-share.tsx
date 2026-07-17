"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ShareBarList,
	ShareBarListContent,
	ShareBarListFill,
	ShareBarListItem,
	ShareBarListLabel,
	ShareBarListValue,
} from "@/components/share-bar-list";

const browsers = [
	{ label: "Chrome", share: 58 },
	{ label: "Safari", share: 22 },
	{ label: "Edge", share: 9 },
	{ label: "Firefox", share: 7 },
	{ label: "Other", share: 4 },
] as const;

export function BrowserShare() {
	return (
		<Card className="dark:bg-transparent">
			<CardHeader className="border-b">
				<CardTitle className="text-balance">Browsers</CardTitle>
				<CardDescription className="text-pretty">
					Share of sessions by primary browser family.
				</CardDescription>
			</CardHeader>
			<CardContent className="p-0 py-1">
				<ShareBarList aria-label="Sessions by browser">
					{browsers.map((row) => (
						<ShareBarListItem key={row.label} value={row.share}>
							<ShareBarListContent>
								<ShareBarListLabel>{row.label}</ShareBarListLabel>
								<ShareBarListValue>{row.share}%</ShareBarListValue>
							</ShareBarListContent>
							<ShareBarListFill />
						</ShareBarListItem>
					))}
				</ShareBarList>
			</CardContent>
		</Card>
	);
}
