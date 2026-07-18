import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Info } from "lucide-react";

import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { FEE_BPS } from "../../../convex/lib/constants";
import { DashboardLayout } from "@/components/DashboardLayout";
import { formatMoney } from "@/lib/format-money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/settings/payments")({ component: SettingsPaymentsPage });

const FEE_PERCENT = FEE_BPS / 100;

const METHOD_LABEL = { cash: "Cash", card: "Card", online: "Online" } as const;

function SettingsPaymentsPage() {
  const { data: earnings } = useQuery(convexQuery(api.payments.getEarnings, {}));
  const { data: me } = useQuery(convexQuery(api.organizers.getMe, {}));

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What you&apos;ve collected across your events, and how fees are handled.
          </p>
        </div>

        <EarningsSection earnings={earnings} />
        <BreakdownSection earnings={earnings} />
        <FeesSection me={me} />
        <PayoutsNote />
      </div>
    </DashboardLayout>
  );
}

type Earnings = FunctionReturnType<typeof api.payments.getEarnings>;

function EarningsSection({ earnings }: { earnings: Earnings | undefined }) {
  if (!earnings) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-7 w-24" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  const { currency, paid, pending } = earnings;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>Net payout</CardDescription>
          <CardTitle className="text-2xl tabular-nums tracking-tight">
            {formatMoney(paid.netPayoutCents, currency)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">what you keep</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Gross collected</CardDescription>
          <CardTitle className="text-2xl tabular-nums tracking-tight">
            {formatMoney(paid.grossCents, currency)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground tabular-nums">
          {paid.count} paid {paid.count === 1 ? "order" : "orders"}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Platform fees</CardDescription>
          <CardTitle className="text-2xl tabular-nums tracking-tight">
            {formatMoney(paid.feeCents, currency)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground tabular-nums">
          {FEE_PERCENT}% per paid order
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Pending</CardDescription>
          <CardTitle className="text-2xl tabular-nums tracking-tight">
            {formatMoney(pending.amountCents, currency)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground tabular-nums">
          {pending.count} awaiting payment
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownSection({ earnings }: { earnings: Earnings | undefined }) {
  if (!earnings) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { currency, paid, pending, refunded, cancelled, byMethod } = earnings;
  const hasOrders =
    paid.count + pending.count + refunded.count + cancelled.count > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout by method</CardTitle>
        <CardDescription>How your paid orders were collected.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasOrders ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Net payout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["cash", "card", "online"] as const).map((m) => (
                    <TableRow key={m}>
                      <TableCell className="font-medium">{METHOD_LABEL[m]}</TableCell>
                      <TableCell className="text-right tabular-nums">{byMethod[m].count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(byMethod[m].payoutCents, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>{paid.count} paid</span>
              <span>{pending.count} pending</span>
              <span>
                {refunded.count} refunded
                {refunded.amountCents > 0
                  ? ` (${formatMoney(refunded.amountCents, currency)})`
                  : ""}
              </span>
              <span>{cancelled.count} cancelled</span>
            </div>
          </>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            No orders yet. Sales from your events will appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type Me = NonNullable<FunctionReturnType<typeof api.organizers.getMe>>;

function FeesSection({ me }: { me: Me | null | undefined }) {
  const updatePreferences = useMutation(api.organizers.updatePreferences);
  const [feeMode, setFeeMode] = React.useState<"pass" | "absorb">("pass");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (me) setFeeMode(me.defaultFeeMode ?? "pass");
  }, [me]);

  async function save() {
    setSaving(true);
    try {
      await updatePreferences({ defaultFeeMode: feeMode });
      toast.success("Fee setting saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fees</CardTitle>
        <CardDescription>
          Passline takes a {FEE_PERCENT}% platform fee on each paid order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!me ? (
          <Skeleton className="h-9 w-72" />
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">Default fee handling for new events</p>
              <ToggleGroup
                type="single"
                variant="outline"
                value={feeMode}
                onValueChange={(v) => v && setFeeMode(v as "pass" | "absorb")}
                className="justify-start"
              >
                <ToggleGroupItem value="pass" className="h-9 px-3">Pass to buyer</ToggleGroupItem>
                <ToggleGroupItem value="absorb" className="h-9 px-3">Absorb</ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {feeMode === "pass"
                  ? "The buyer pays the fee on top of the ticket price; your payout is the full ticket price."
                  : "You cover the fee out of the ticket price; your payout is the price minus the fee."}
              </p>
            </div>
            <Button onClick={save} disabled={saving}>
              Save fee setting
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PayoutsNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payouts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Bank payouts aren&apos;t connected yet. The figures above are what you&apos;ve
            collected and kept in Passline; online card processing and automatic payouts
            are coming soon.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
