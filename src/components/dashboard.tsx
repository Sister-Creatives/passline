import { AudienceMix } from "@/components/audience-mix";
import { BrowserShare } from "@/components/browser-share";
import { OnlineNow } from "@/components/online-now";
import { TopCountries } from "@/components/top-countries";
import { TopPages } from "@/components/top-pages";
import { TopReferrers } from "@/components/top-referrers";
import { TrafficSourcesChart } from "@/components/traffic-sources-chart";
import { VisitorsChart } from "@/components/visitors-chart";
import { WebVitals } from "@/components/web-vitals";

export function Dashboard() {
	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
			<VisitorsChart />
			<OnlineNow />
			<TopPages />
			<TopCountries />
			<TrafficSourcesChart />
			<AudienceMix />
			<BrowserShare />
			<TopReferrers />
			<WebVitals />
		</div>
	);
}
