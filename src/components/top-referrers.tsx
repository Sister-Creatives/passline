import { formatInteger } from "@/lib/formater";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ArrowRightIcon } from "lucide-react";

const rows = [
	{ host: "news.ycombinator.com", sessions: 1420 },
	{ host: "t.co", sessions: 980 },
	{ host: "github.com", sessions: 760 },
	{ host: "producthunt.com", sessions: 540 },
	{ host: "reddit.com", sessions: 410 },
] as const;

export function TopReferrers() {
	return (
		<Card className="relative dark:bg-transparent">
			<CardHeader>
				<CardTitle className="text-balance">Top referrers</CardTitle>
				<CardDescription className="text-pretty">
					External sites sending the most attributed sessions.
				</CardDescription>
			</CardHeader>
			<CardContent className="mask-b-from-50% mask-b-to-100% p-0 pb-2">
				<Table className="border-t">
					<TableCaption className="sr-only">
						Top referrer domains by attributed sessions.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-6" scope="col">
								Host
							</TableHead>
							<TableHead className="pr-6 text-end tabular-nums" scope="col">
								Sessions
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow className="hover:bg-transparent" key={row.host}>
								<TableCell className="max-w-[220px] truncate pl-6 font-medium">
									<span className="text-xs">{row.host}</span>
								</TableCell>
								<TableCell className="pr-6 text-end text-muted-foreground text-xs tabular-nums">
									{formatInteger(row.sessions)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>

			<div className="mask-t-from-30% absolute inset-x-0 bottom-0 flex h-1/5 items-center justify-center bg-background">
				<Button asChild className="relative" variant="ghost">
					<a href="#">
						View All
						<ArrowRightIcon aria-hidden="true" />
					</a>
				</Button>
			</div>
		</Card>
	);
}
