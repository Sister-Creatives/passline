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

const FLAGPACK_BASE = "https://flag.vercel.app";

const rows = [
	{ code: "US", visits: 6120, delta: 5.2 },
	{ code: "DE", visits: 2840, delta: 8.1 },
	{ code: "GB", visits: 1960, delta: -1.4 },
	{ code: "FR", visits: 1420, delta: 3.6 },
	{ code: "CA", visits: 1180, delta: 0.9 },
	{ code: "NL", visits: 890, delta: 12.2 },
] as const;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function flagUrl(countryCode: string) {
	return `${FLAGPACK_BASE}/s/${countryCode.toUpperCase()}.svg`;
}

export function TopCountries() {
	return (
		<Card className="relative md:col-span-2 dark:bg-transparent">
			<CardHeader>
				<CardTitle className="text-balance">Top countries</CardTitle>
				<CardDescription className="text-pretty">
					Top countries in the last 12 months.
				</CardDescription>
			</CardHeader>
			<CardContent className="mask-b-from-50% mask-b-to-100% p-0 pb-2">
				<Table className="border-t">
					<TableCaption className="sr-only">
						Top countries by visits with year-over-year change.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-6" scope="col">
								Country
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
							<TableRow className="hover:bg-transparent" key={row.code}>
								<TableCell className="max-w-[220px] truncate pl-6 font-medium">
									<span className="inline-flex max-w-full items-center gap-2">
										<img
											alt={`Flag of ${row.code}`}
											className="h-3.5 w-5 shrink-0 rounded object-cover"
											height={14}
											src={flagUrl(row.code)}
											width={20}
										/>
										<span className="min-w-0 truncate text-xs">
											{regionNames.of(row.code) ?? row.code}
										</span>
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
