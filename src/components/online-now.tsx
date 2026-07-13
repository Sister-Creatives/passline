"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusIndicator } from "@/components/indicator";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
	ShareBarList,
	ShareBarListContent,
	ShareBarListFill,
	ShareBarListItem,
	ShareBarListLabel,
	ShareBarListValue,
} from "@/components/share-bar-list";

const devices = [
	{ label: "Mobile", share: 65 },
	{ label: "Desktop", share: 33 },
	{ label: "Tablet", share: 2 },
] as const;

export function OnlineNow() {
	return (
		<Card className="gap-0 pb-0 md:col-span-2 lg:col-span-1 dark:bg-transparent">
			<CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
				<div className="flex min-w-0 flex-col gap-0">
					<CardTitle className="font-mono text-2xl tabular-nums">94</CardTitle>
					<CardDescription>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									className={cn(
										"cursor-help px-1 py-px font-normal text-muted-foreground",
										"hover:underline-0"
									)}
									type="button"
									variant="link"
								>
									<StatusIndicator />
									<span>visitors online</span>
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								In the last 5 minutes.
							</TooltipContent>
						</Tooltip>
					</CardDescription>
				</div>
				<Delta value={14.8} variant="badge">
					<DeltaIcon variant="trend" />
					<DeltaValue suffix="%" />
				</Delta>
			</CardHeader>
			<CardContent
				className={cn("relative flex h-full items-center px-0 py-2")}
			>
				<ShareBarList>
					{devices.map((d) => (
						<ShareBarListItem key={d.label} value={d.share}>
							<ShareBarListContent>
								<ShareBarListLabel>{d.label}</ShareBarListLabel>
								<ShareBarListValue>{d.share}%</ShareBarListValue>
							</ShareBarListContent>
							<ShareBarListFill data-online-bar />
						</ShareBarListItem>
					))}
				</ShareBarList>
			</CardContent>
		</Card>
	);
}
