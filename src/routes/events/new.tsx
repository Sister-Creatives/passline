import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/AuthGuard";
import { EventForm } from "@/components/EventForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export const Route = createFileRoute("/events/new")({ component: NewEventPage });

function NewEventPage() {
  return (
    <AuthGuard>
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">New event</h1>
        <Card className="mt-6">
          <CardHeader>
            <CardDescription>
              Events start as drafts. You can publish once you&apos;re ready for guests to RSVP.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EventForm />
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
