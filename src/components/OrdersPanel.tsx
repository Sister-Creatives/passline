import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const STATUS_VARIANT = {
  pending: "secondary",
  paid: "default",
  cancelled: "outline",
  refunded: "outline",
} as const;

const STATUS_LABEL = {
  pending: "Pending",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
} as const;

/**
 * Orders tab: the event's orders (newest first), read-only. One row per
 * order -- buyer (name + email), status Badge, item count, total via
 * formatMoney, and created date. Mirrors TicketTypesPanel's
 * Skeleton/Empty/Table shape.
 */
export function OrdersPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: orders, isPending } = useQuery(
    convexQuery(api.orders.listOrdersForEvent, { eventId }),
  );
  const refundOrder = useMutation(api.orders.refundOrder);

  async function handleRefund(orderId: Id<"orders">) {
    try {
      await refundOrder({ orderId });
      toast.success("Order refunded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refund order");
    }
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const rows = orders ?? [];

  const header = <h2 className="mb-4 text-lg font-medium">Orders</h2>;

  if (rows.length === 0) {
    return (
      <div>
        {header}
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyTitle>No orders yet</EmptyTitle>
            <EmptyDescription>Orders will show up here once buyers check out.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Buyer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => (
            <TableRow key={order._id}>
              <TableCell>
                <div className="font-medium">{order.buyerName}</div>
                <div className="text-sm text-muted-foreground">{order.buyerEmail}</div>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(order.totalCents, order.currency)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {new Date(order.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                {order.status === "paid" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        Refund
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Refund this order?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Tickets will be cancelled and capacity released. Until payments are
                          live, the card refund itself is issued separately -- this only updates
                          records and inventory.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleRefund(order._id)}
                        >
                          Refund
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
