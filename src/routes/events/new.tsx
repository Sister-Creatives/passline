import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { ArrowLeftIcon } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { DashboardLayout } from "@/components/DashboardLayout";
import { EventForm } from "@/components/EventForm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/events/new")({ component: NewEventPage });

function NewEventPage() {
  const { data: me } = useQuery(convexQuery(api.organizers.getMe, {}));

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-2xl">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
          <Link to="/events">
            <ArrowLeftIcon /> Back to events
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Create an event</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start with the basics &mdash; you&apos;ll add tickets, seating, and design in the builder
          next.
        </p>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Event basics</CardTitle>
            <CardDescription>
              This creates a draft. Nothing goes public until you publish from the builder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {me === undefined ? (
              <div className="grid gap-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-32" />
              </div>
            ) : (
              <EventForm
                defaults={{
                  location: me?.defaultLocation,
                  capacity: me?.defaultCapacity,
                  currency: me?.defaultCurrency,
                  feeMode: me?.defaultFeeMode,
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
