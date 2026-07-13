import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/badge";
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

const STATUS_VARIANT = {
  pending: "secondary",
  paid: "default",
  cancelled: "outline",
} as const;

const STATUS_LABEL = {
  pending: "Pending",
  paid: "Paid",
  cancelled: "Cancelled",
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

  if (rows.length === 0) {
    return (
      <Empty className="mt-6">
        <EmptyHeader>
          <EmptyTitle>No orders yet</EmptyTitle>
          <EmptyDescription>Orders will show up here once buyers check out.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Buyer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Items</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Created</TableHead>
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
            <TableCell className="text-right text-muted-foreground">
              {new Date(order.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
