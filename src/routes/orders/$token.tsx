import { Suspense, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { formatEventDateRange } from "@/lib/format-event-date";
import { VirtualHubView, type VirtualHubViewData } from "@/components/VirtualHubView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// PUBLIC route: no AuthGuard. This is the buyer's own order, reached via the
// unguessable order token returned at checkout -- no account required.
// Mirrors /rsvp/$token and /e/$slug's public-route convention.
export const Route = createFileRoute("/orders/$token")({ component: OrderPage });

const ORDER_STATUS_VARIANT = {
  pending: "secondary",
  paid: "default",
  cancelled: "outline",
  refunded: "outline",
} as const;

const ORDER_STATUS_LABEL = {
  pending: "Pending",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
} as const;

const TICKET_STATUS_VARIANT = {
  valid: "default",
  checked_in: "secondary",
  cancelled: "outline",
} as const;

const TICKET_STATUS_LABEL = {
  valid: "Valid",
  checked_in: "Checked in",
  cancelled: "Cancelled",
} as const;

function OrderPage() {
  const { token } = Route.useParams();
  return (
    <Suspense fallback={<OrderPageSkeleton />}>
      <OrderPageContent token={token} />
    </Suspense>
  );
}

function OrderPageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-4 h-28 w-full" />
      <Skeleton className="mt-8 h-6 w-24" />
      <Skeleton className="mt-4 h-16 w-full" />
      <Skeleton className="mt-3 h-16 w-full" />
    </div>
  );
}

function OrderPageContent({ token }: { token: string }) {
  const { data } = useSuspenseQuery(convexQuery(api.orders.getOrder, { token }));
  // Ticket holders are entitled to the hub by holding this order's token --
  // no separate password gate. Null when the hub isn't set up / enabled, the
  // order is cancelled, or the token is unknown (see virtualHub.getForOrder).
  const { data: hub } = useSuspenseQuery(convexQuery(api.virtualHub.getForOrder, { token }));

  if (!data) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Order not found</EmptyTitle>
            <EmptyDescription>
              This link is invalid or the order no longer exists.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const { order, event, tickets } = data;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      {event ? (
        // Authors may embed inline <i>/<em>/<br>/<strong> in the title.
        <h1
          className="text-2xl font-semibold sm:text-3xl"
          dangerouslySetInnerHTML={{ __html: event.title }}
        />
      ) : (
        <h1 className="text-2xl font-semibold sm:text-3xl">Your order</h1>
      )}
      {event && (
        <p className="mt-2 text-sm text-muted-foreground">
          {formatEventDateRange(event.startsAt, event.endsAt)}
        </p>
      )}

      <Card className="mt-6">
        <CardHeader>
          <Badge variant={ORDER_STATUS_VARIANT[order.status]}>
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <CardDescription>
            {order.buyerName} &middot; {order.buyerEmail}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">
            Total: {formatMoney(order.totalCents, order.currency)}
          </p>
        </CardContent>
      </Card>

      {hub && (
        <div className="mt-6">
          <VirtualHubView hub={hub as VirtualHubViewData} />
        </div>
      )}

      <h2 className="mt-8 text-lg font-medium">Tickets</h2>
      <div className="mt-4 flex flex-col gap-3">
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets on this order yet.</p>
        ) : (
          tickets.map((ticket) => <TicketRow key={ticket._id} token={token} ticket={ticket} />)
        )}
      </div>
    </div>
  );
}

function TicketRow({ token, ticket }: { token: string; ticket: Doc<"tickets"> }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={TICKET_STATUS_VARIANT[ticket.status]}>
              {TICKET_STATUS_LABEL[ticket.status]}
            </Badge>
            <span className="text-sm text-muted-foreground">{ticket.code}</span>
          </div>
          <p className="mt-1 text-sm">
            {ticket.attendeeName ?? "No attendee assigned"}
            {ticket.attendeeEmail ? ` · ${ticket.attendeeEmail}` : ""}
          </p>
        </div>
        {ticket.status === "valid" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Transfer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer ticket</DialogTitle>
              </DialogHeader>
              <TransferTicketForm token={token} ticket={ticket} onDone={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

const transferFormSchema = z.object({
  attendeeName: z.string().min(1, "Name is required"),
  attendeeEmail: z.email("Enter a valid email address").or(z.literal("")),
});

type TransferFormValues = z.infer<typeof transferFormSchema>;

/**
 * Reassign a ticket to a new attendee. Public -- authorized by the order
 * token (from the enclosing page's URL), not by any account, mirroring
 * RsvpForm's public-mutation pattern. Prefills from the ticket's current
 * attendee so re-opening the dialog shows what's already on file.
 */
function TransferTicketForm({
  token,
  ticket,
  onDone,
}: {
  token: string;
  ticket: Doc<"tickets">;
  onDone: () => void;
}) {
  const transferTicket = useMutation(api.tickets.transferTicket);
  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      attendeeName: ticket.attendeeName ?? "",
      attendeeEmail: ticket.attendeeEmail ?? "",
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: TransferFormValues) {
    try {
      await transferTicket({
        orderToken: token,
        ticketId: ticket._id,
        attendeeName: values.attendeeName,
        attendeeEmail: values.attendeeEmail || undefined,
      });
      toast.success("Ticket transferred");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to transfer ticket");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        <FormField
          control={form.control}
          name="attendeeName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Attendee name" autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="attendeeEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="attendee@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <LoaderCircle className="animate-spin" />}
          Transfer
        </Button>
      </form>
    </Form>
  );
}
