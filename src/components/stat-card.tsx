import { cn } from "@/lib/utils";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/sparkline";

export function StatCard({
  label,
  value,
  sub,
  deltaPct = null,
  spark,
}: {
  label: string;
  value: string | number;
  sub?: string;
  deltaPct?: number | null;
  spark?: number[];
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden", spark ? "pb-0" : undefined)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {deltaPct !== null && (
            <Delta value={Math.round(deltaPct)} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue suffix="%" />
            </Delta>
          )}
        </div>
        <CardTitle className="text-3xl tabular-nums tracking-tight">{value}</CardTitle>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardHeader>
      {spark && <Sparkline data={spark} />}
    </Card>
  );
}
