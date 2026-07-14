import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
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

/**
 * Activity tab: a read-only Table of the event's audit trail (when, action,
 * summary), newest first. Mirrors AccessCodesPanel's Skeleton/Empty/Table
 * shape -- no mutations here, this panel only reads api.audit.listForEvent.
 */
export function AuditLogPanel({ eventId }: { eventId: Id<"events"> }) {
  const { data: entries, isPending } = useQuery(
    convexQuery(api.audit.listForEvent, { eventId }),
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

  const rows = entries ?? [];

  if (rows.length === 0) {
    return (
      <Empty className="mt-6">
        <EmptyHeader>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>
            Changes to this event, like publishing or editing ticket types, will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Summary</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((entry: Doc<"auditLogs">) => (
          <TableRow key={entry._id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{entry.action}</Badge>
            </TableCell>
            <TableCell>{entry.summary}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
