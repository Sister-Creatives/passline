import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatEventDateRange } from "@/lib/format-event-date";

// PUBLIC route: no AuthGuard. This is the attendee's own ticket, reached via
// their unguessable RSVP token (emailed to them) -- no account required.
export const Route = createFileRoute("/rsvp/$token")({ component: RsvpConfirmationPage });

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  confirmed_pending_claim: "Pending claim",
  waitlisted: "Waitlisted",
  checked_in: "Checked in",
  cancelled: "Cancelled",
};

function RsvpConfirmationPage() {
  const { token } = Route.useParams();
  return (
    <Suspense
      fallback={<div className="p-8 text-sm text-muted-foreground">Loading ticket…</div>}
    >
      <RsvpConfirmationContent token={token} />
    </Suspense>
  );
}

function RsvpConfirmationContent({ token }: { token: string }) {
  const { data: ticket } = useSuspenseQuery(convexQuery(api.rsvps.getRsvpByToken, { token }));

  if (!ticket) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-semibold">Ticket not found</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-4 sm:p-8">
      {/* Authors may embed inline <i>/<em>/<br>/<strong> in the title. */}
      <h1
        className="text-2xl font-semibold sm:text-3xl"
        dangerouslySetInnerHTML={{ __html: ticket.eventTitle }}
      />
      <Card className="mt-6">
        <CardHeader>
          <Badge variant={ticket.status === "confirmed" ? "default" : "secondary"}>
            {STATUS_LABEL[ticket.status] ?? ticket.status}
          </Badge>
          <CardDescription>{ticket.name}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <p className="text-sm">
            {formatEventDateRange(ticket.eventStartsAt, ticket.eventEndsAt)}
          </p>
          <p className="text-sm text-muted-foreground">{ticket.eventLocation}</p>
          {/*
            QR code placeholder for Task 11: render a scannable QR code here
            (the `qrcode` package is already a dependency) encoding this
            ticket's token, for door check-in. Not implemented in this task.
          */}
        </CardContent>
      </Card>
    </div>
  );
}
