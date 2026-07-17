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
	{ path: "/", visits: 18_420, delta: 4.1 },
	{ path: "/pricing", visits: 6280, delta: 12.4 },
	{ path: "/blog/product-updates", visits: 4110, delta: -2.0 },
	{ path: "/docs/getting-started", visits: 3920, delta: 6.8 },
	{ path: "/changelog", visits: 2150, delta: 0.4 },
] as const;

export function TopPages() {
	return (
		<Card className="relative md:col-span-2 dark:bg-transparent">
			<CardHeader>
				<CardTitle className="text-balance">Top pages</CardTitle>
				<CardDescription className="text-pretty">
					First page in session, ranked by visits.
				</CardDescription>
			</CardHeader>
			<CardContent className="mask-b-from-50% mask-b-to-100% p-0 pb-2">
				<Table className="border-t">
					<TableCaption className="sr-only">
						Top landing pages by visits with year-over-year change.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-6" scope="col">
								Path
							</TableHead>
							<TableHead className="text-end tabular-nums" scope="col">
								Visits
							</TableHead>
							<TableHead className="pr-6 text-end" scope="col">
								Change
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow className="hover:bg-transparent" key={row.path}>
								<TableCell className="max-w-[200px] truncate pl-6 font-medium">
									<span className="w-max rounded border border-border bg-muted/50 px-1 py-px text-xs">
										{row.path}
									</span>
								</TableCell>
								<TableCell className="text-end text-muted-foreground text-xs tabular-nums">
									{formatInteger(row.visits)}
								</TableCell>
								<TableCell className="pr-6 text-end text-muted-foreground text-xs">
									<span className="tabular-nums">
										{row.delta > 0 ? "+" : ""}
										{row.delta}%
									</span>
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
