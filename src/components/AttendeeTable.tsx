import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AttendeeRow {
  _id: string;
  name: string;
  email: string;
}

interface AttendeeTableProps<T extends AttendeeRow> {
  title: string;
  attendees: T[];
  emptyMessage: string;
  /** Optional per-row action slot, e.g. a cancel button. */
  renderAction?: (attendee: T) => React.ReactNode;
}

/**
 * Reusable shadcn `Table` for a single bucket of attendees (confirmed,
 * pending claim, or waitlisted). Renders name + email columns, plus an
 * optional action column when `renderAction` is supplied.
 */
export function AttendeeTable<T extends AttendeeRow>({
  title,
  attendees,
  emptyMessage,
  renderAction,
}: AttendeeTableProps<T>) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      {attendees.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              {renderAction && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendees.map((attendee) => (
              <TableRow key={attendee._id}>
                <TableCell className="font-medium">{attendee.name}</TableCell>
                <TableCell>{attendee.email}</TableCell>
                {renderAction && (
                  <TableCell className="text-right">{renderAction(attendee)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
