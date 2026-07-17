import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";

const vitals = [
	{
		label: "LCP",
		name: "Largest Contentful Paint",
		value: "1.9s",
		delta: 120,
		deltaLabel: "faster vs prior month",
		suffix: "ms",
	},
	{
		label: "INP",
		name: "Interaction to Next Paint",
		value: "142ms",
		delta: 18,
		deltaLabel: "faster vs prior month",
		suffix: "ms",
	},
	{
		label: "CLS",
		name: "Cumulative Layout Shift",
		value: "0.04",
		delta: 0.07,
		deltaLabel: "lower vs prior month",
		suffix: "",
	},
] as const;

export function WebVitals() {
	return (
		<Card className="md:col-span-2 lg:col-span-4 dark:bg-transparent">
			<CardHeader className="border-b">
				<CardTitle className="text-balance">Core Web Vitals</CardTitle>
				<CardDescription className="text-pretty">
					Field experience on real sessions, measured at the origin.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="grid gap-6 sm:grid-cols-3">
					{vitals.map((v) => (
						<li className="flex flex-col gap-1" key={v.label}>
							<p className="text-pretty font-medium text-sm">{v.label}</p>
							<p className="text-pretty text-muted-foreground text-xs">
								{v.name}
							</p>
							<p className="text-balance font-semibold text-2xl tabular-nums">
								{v.value}
							</p>
							<div className="flex items-center gap-1.5 text-pretty text-muted-foreground text-xs">
								<Delta value={v.delta} variant="default">
									<DeltaIcon />
									<DeltaValue suffix={v.suffix} />
								</Delta>
								<span>{v.deltaLabel}</span>
							</div>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
