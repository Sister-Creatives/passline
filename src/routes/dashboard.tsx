import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard")({ component: OverviewPage });

function OverviewPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <OverviewCards />
      </div>
    </DashboardLayout>
  );
}

function OverviewCards() {
  const { data: events, isPending } = useQuery(convexQuery(api.events.listMyEvents, {}));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Your events</CardDescription>
          <CardTitle className="text-3xl tabular-nums">
            {isPending ? <Skeleton className="h-9 w-12" /> : events!.length}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link to="/events">Manage events</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
