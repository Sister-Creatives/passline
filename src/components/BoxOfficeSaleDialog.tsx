import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { LoaderCircle, Minus, Plus, Store } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PaymentMethod = "cash" | "card";

/** Bumps `id`'s quantity in a quantity map by `delta`, clamped to [0, max]. */
function adjustQuantity(
  setMap: React.Dispatch<React.SetStateAction<Record<string, number>>>,
  id: string,
  delta: number,
  max?: number,
) {
  setMap((prev) => {
    const next = (prev[id] ?? 0) + delta;
    const clamped = Math.max(0, max !== undefined ? Math.min(next, max) : next);
    return { ...prev, [id]: clamped };
  });
}

type SeatRow = {
  id: Id<"seats">;
  ticketTypeId: Id<"ticketTypes">;
  section: string;
  row: string;
  number: number;
  status: "available" | "sold";
};

/**
 * F10.4: a clickable seat grid for a seated ticket type -- grouped by
 * section then row (seats already arrive sorted by section/sortOrder from
 * `seats.listForEvent`). Available seats toggle into/out of `selected`; sold
 * seats are disabled/greyed, mirroring SeatingPanel's read-only grid but
 * interactive.
 */
function SeatPicker({
  seats,
  selected,
  onToggle,
}: {
  seats: SeatRow[];
  selected: ReadonlySet<Id<"seats">>;
  onToggle: (seatId: Id<"seats">) => void;
}) {
  const sections = new Map<string, SeatRow[]>();
  for (const seat of seats) {
    const list = sections.get(seat.section) ?? [];
    list.push(seat);
    sections.set(seat.section, list);
  }

  return (
    <div className="flex flex-col gap-2">
      {[...sections.entries()].map(([section, sectionSeats]) => {
        const rows = new Map<string, SeatRow[]>();
        for (const seat of sectionSeats) {
          const list = rows.get(seat.row) ?? [];
          list.push(seat);
          rows.set(seat.row, list);
        }
        return (
          <div key={section} className="flex flex-col gap-1">
            {sections.size > 1 && (
              <p className="text-xs font-medium text-muted-foreground">{section}</p>
            )}
            {[...rows.entries()].map(([row, rowSeats]) => (
              <div key={row} className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{row}</span>
                <div className="flex flex-wrap gap-1">
                  {rowSeats.map((seat) => {
                    const isSold = seat.status === "sold";
                    const isSelected = selected.has(seat.id);
                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={isSold}
                        onClick={() => onToggle(seat.id)}
                        title={`${seat.section} ${seat.row}${seat.number}${isSold ? " · sold" : ""}`}
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-sm border text-[10px] tabular-nums transition-colors",
                          isSold
                            ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground/50"
                            : isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-foreground hover:bg-accent",
                        )}
                      >
                        {seat.number}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * "Sell at the door" box office flow (F18 §6): an organizer-facing Dialog
 * that builds a walk-up cart (ticket types + optional add-ons, via quantity
 * steppers) and submits it to `api.orders.createBoxOfficeOrder`, which issues
 * tickets immediately. Only `active` + `visible` ticket types are offered --
 * a `hidden` type would be rejected server-side without an access code, which
 * doesn't apply to a door sale.
 *
 * The form's local state (quantities, buyer name, payment method) is never
 * manually reset: shadcn's Dialog unmounts `DialogContent`'s children while
 * closed, so re-opening always mounts a fresh `BoxOfficeForm`.
 */
export function BoxOfficeSaleDialog({
  eventId,
  currency,
}: {
  eventId: Id<"events">;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Store /> Sell at the door
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sell at the door</DialogTitle>
          <DialogDescription>
            Pick tickets and add-ons for a walk-up sale. Tickets issue immediately.
          </DialogDescription>
        </DialogHeader>
        <BoxOfficeForm eventId={eventId} currency={currency} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BoxOfficeForm({
  eventId,
  currency,
  onDone,
}: {
  eventId: Id<"events">;
  currency: string;
  onDone: () => void;
}) {
  const { data: ticketTypes, isPending: typesPending } = useQuery(
    convexQuery(api.ticketTypes.listForEvent, { eventId }),
  );
  const { data: addOns, isPending: addOnsPending } = useQuery(
    convexQuery(api.addOns.listForEvent, { eventId }),
  );
  // F13: multi-session events require a sessionId on every order. Only a
  // published event with >= 1 session returns any rows here, so the picker
  // (below) stays hidden for single-session events -- the default, unchanged
  // door-sale flow.
  const { data: sessions, isPending: sessionsPending } = useQuery(
    convexQuery(api.eventSessions.listForEvent, { eventId }),
  );
  // F10: a ticket type with >= 1 seats row is "seated" -- its picker replaces
  // the quantity stepper below. `seats.listForEvent` is the public (published
  // events only) query, which matches `createBoxOfficeOrder`'s own
  // published-event requirement, so this never hides a seat map that a sale
  // could actually reach.
  const { data: seatsData, isPending: seatsPending } = useQuery(
    convexQuery(api.seats.listForEvent, { eventId }),
  );
  const createBoxOfficeOrder = useMutation(api.orders.createBoxOfficeOrder);

  const [ticketQuantities, setTicketQuantities] = useState<Record<string, number>>({});
  const [addOnQuantities, setAddOnQuantities] = useState<Record<string, number>>({});
  const [selectedSeats, setSelectedSeats] = useState<Record<string, Id<"seats">[]>>({});
  const [buyerName, setBuyerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [sessionId, setSessionId] = useState<Id<"eventSessions"> | "">("");
  const [submitting, setSubmitting] = useState(false);

  if (typesPending || addOnsPending || sessionsPending || seatsPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // A box-office sale skips the access-code gate entirely (there's no
  // checkout flow to type a code into), so only visible, active ticket
  // types can be offered here -- a hidden one would be rejected server-side.
  const sellableTicketTypes = (ticketTypes ?? []).filter(
    (tt) => tt.status === "active" && tt.visibility === "visible",
  );
  const activeAddOns = (addOns ?? []).filter((a) => a.active);
  const eventSessions = sessions ?? [];
  const hasSessions = eventSessions.length > 0;

  // F10: group seats by ticket type -- a type with >= 1 seats row is
  // "seated" and gets a picker instead of a quantity stepper below.
  const seatsByTicketType = new Map<string, SeatRow[]>();
  for (const seat of seatsData ?? []) {
    const list = seatsByTicketType.get(seat.ticketTypeId) ?? [];
    list.push(seat);
    seatsByTicketType.set(seat.ticketTypeId, list);
  }

  function toggleSeat(ticketTypeId: string, seatId: Id<"seats">) {
    setSelectedSeats((prev) => {
      const current = prev[ticketTypeId] ?? [];
      const next = current.includes(seatId)
        ? current.filter((id) => id !== seatId)
        : [...current, seatId];
      return { ...prev, [ticketTypeId]: next };
    });
  }

  const items: { ticketTypeId: Id<"ticketTypes">; quantity?: number; seatIds?: Id<"seats">[] }[] =
    [];
  for (const tt of sellableTicketTypes) {
    const seatsForType = seatsByTicketType.get(tt._id) ?? [];
    if (seatsForType.length > 0) {
      const seatIds = selectedSeats[tt._id] ?? [];
      if (seatIds.length > 0) items.push({ ticketTypeId: tt._id, seatIds });
    } else {
      const quantity = ticketQuantities[tt._id] ?? 0;
      if (quantity > 0) items.push({ ticketTypeId: tt._id, quantity });
    }
  }
  const addOnItems = Object.entries(addOnQuantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([addOnId, quantity]) => ({ addOnId: addOnId as Id<"addOns">, quantity }));

  const subtotalCents =
    sellableTicketTypes.reduce((sum, tt) => {
      const seatsForType = seatsByTicketType.get(tt._id) ?? [];
      const quantity =
        seatsForType.length > 0
          ? (selectedSeats[tt._id]?.length ?? 0)
          : (ticketQuantities[tt._id] ?? 0);
      return sum + tt.priceCents * quantity;
    }, 0) + activeAddOns.reduce((sum, a) => sum + a.priceCents * (addOnQuantities[a._id] ?? 0), 0);

  const canSubmit =
    buyerName.trim().length > 0 &&
    (items.length > 0 || addOnItems.length > 0) &&
    (!hasSessions || sessionId !== "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const result = await createBoxOfficeOrder({
        eventId,
        items,
        addOnItems: addOnItems.length > 0 ? addOnItems : undefined,
        buyerName: buyerName.trim(),
        paymentMethod,
        sessionId: hasSessions && sessionId !== "" ? sessionId : undefined,
      });
      const total = formatMoney(result.totalCents, currency);
      toast.success(
        paymentMethod === "cash"
          ? `Sold for ${total} -- cash sale, no booking fee`
          : `Sold for ${total}`,
      );
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sale failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (sellableTicketTypes.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No ticket types available</EmptyTitle>
          <EmptyDescription>
            Add a visible, active ticket type before selling at the door.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {sellableTicketTypes.map((tt) => {
          const seatsForType = seatsByTicketType.get(tt._id) ?? [];
          if (seatsForType.length > 0) {
            const selected = new Set(selectedSeats[tt._id] ?? []);
            const availableCount = seatsForType.filter((s) => s.status === "available").length;
            return (
              <div key={tt._id} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{tt.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {tt.kind === "free" ? "Free" : formatMoney(tt.priceCents, currency)} ·{" "}
                      {availableCount} available
                    </p>
                  </div>
                  {selected.size > 0 && (
                    <span className="text-xs font-medium tabular-nums">
                      {selected.size} selected
                    </span>
                  )}
                </div>
                <SeatPicker
                  seats={seatsForType}
                  selected={selected}
                  onToggle={(seatId) => toggleSeat(tt._id, seatId)}
                />
              </div>
            );
          }
          const remaining = tt.capacity !== undefined ? Math.max(0, tt.capacity - tt.sold) : undefined;
          const quantity = ticketQuantities[tt._id] ?? 0;
          return (
            <div
              key={tt._id}
              className="flex items-center justify-between gap-2 rounded-md border p-2"
            >
              <div>
                <p className="text-sm font-medium">{tt.name}</p>
                <p className="text-xs text-muted-foreground">
                  {tt.kind === "free" ? "Free" : formatMoney(tt.priceCents, currency)}
                  {remaining !== undefined && ` · ${remaining} left`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => adjustQuantity(setTicketQuantities, tt._id, -1)}
                  disabled={quantity === 0}
                >
                  <Minus />
                  <span className="sr-only">Fewer {tt.name}</span>
                </Button>
                <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => adjustQuantity(setTicketQuantities, tt._id, 1, remaining)}
                  disabled={remaining !== undefined && quantity >= remaining}
                >
                  <Plus />
                  <span className="sr-only">More {tt.name}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {activeAddOns.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">Add-ons</p>
          {activeAddOns.map((addOn) => {
            const remaining =
              addOn.capacity !== undefined ? Math.max(0, addOn.capacity - addOn.sold) : undefined;
            const quantity = addOnQuantities[addOn._id] ?? 0;
            return (
              <div
                key={addOn._id}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <p className="text-sm font-medium">{addOn.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(addOn.priceCents, currency)}
                    {remaining !== undefined && ` · ${remaining} left`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustQuantity(setAddOnQuantities, addOn._id, -1)}
                    disabled={quantity === 0}
                  >
                    <Minus />
                    <span className="sr-only">Fewer {addOn.name}</span>
                  </Button>
                  <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustQuantity(setAddOnQuantities, addOn._id, 1, remaining)}
                    disabled={remaining !== undefined && quantity >= remaining}
                  >
                    <Plus />
                    <span className="sr-only">More {addOn.name}</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasSessions && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="box-office-session">Session</Label>
          <Select
            value={sessionId}
            onValueChange={(value) => setSessionId(value as Id<"eventSessions">)}
          >
            <SelectTrigger id="box-office-session" className="w-full">
              <SelectValue placeholder="Choose a session" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {eventSessions.map((session) => (
                  <SelectItem key={session._id} value={session._id}>
                    {new Date(session.startsAt).toLocaleString()}
                    {session.label ? ` · ${session.label}` : ""} · {session.remaining} left
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="box-office-buyer-name">Buyer name</Label>
        <Input
          id="box-office-buyer-name"
          value={buyerName}
          onChange={(event) => setBuyerName(event.target.value)}
          placeholder="Name for the ticket"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Payment method</Label>
        <ToggleGroup
          type="single"
          value={paymentMethod}
          onValueChange={(value) => value && setPaymentMethod(value as PaymentMethod)}
          variant="outline"
        >
          <ToggleGroupItem value="cash">Cash</ToggleGroupItem>
          <ToggleGroupItem value="card">Card</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {paymentMethod === "cash"
            ? "Cash sales have no booking fee -- the buyer pays exactly the subtotal."
            : "Card sales carry the event's normal booking fee."}
        </p>
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">Subtotal</span>
        <span className="font-medium tabular-nums">{formatMoney(subtotalCents, currency)}</span>
      </div>

      <Button type="submit" disabled={!canSubmit || submitting}>
        {submitting && <LoaderCircle className="animate-spin" />}
        Complete sale
      </Button>
    </form>
  );
}
