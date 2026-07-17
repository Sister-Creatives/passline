"use client";

import { formatCompactNumber } from "@/lib/formater";
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

const chartData = [
	{ source: "Organic search", sessions: 4120 },
	{ source: "Direct", sessions: 2890 },
	{ source: "Referral", sessions: 1640 },
	{ source: "Paid social", sessions: 980 },
	{ source: "Email", sessions: 620 },
] as const;

const maxSessions = Math.max(...chartData.map((d) => d.sessions));

function barWidthPercent(sessions: number) {
	if (maxSessions <= 0) {
		return 0;
	}
	return (sessions / maxSessions) * 75;
}

export function TrafficSourcesChart() {
	return (
		<Card className="dark:bg-transparent">
			<CardHeader className="border-b">
				<CardTitle className="text-balance">Sessions by source</CardTitle>
				<CardDescription className="text-pretty">
					Attributed sessions in the last 12 months.
				</CardDescription>
			</CardHeader>
			<CardContent className="p-0 py-1">
				<ShareBarList aria-label="Sessions by traffic source">
					{chartData.map((row) => (
						<ShareBarListItem
							key={row.source}
							value={barWidthPercent(row.sessions)}
						>
							<ShareBarListContent>
								<ShareBarListLabel>{row.source}</ShareBarListLabel>
								<ShareBarListValue>
									{formatCompactNumber(row.sessions)}
								</ShareBarListValue>
							</ShareBarListContent>
							<ShareBarListFill />
						</ShareBarListItem>
					))}
				</ShareBarList>
			</CardContent>
		</Card>
	);
}
