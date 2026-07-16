import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * Cumulative "pace to capacity" spark for an events-list row. The y-domain is
 * pinned to the event capacity, so a near-sold-out event visibly climbs toward
 * the top and a quiet one stays low. No axes/grid/tooltip at row scale.
 */
export function PaceChart({ data, capacity }: { data: number[]; capacity: number }) {
  const gradientId = `pace-${useId().replace(/:/g, "")}`;
  const points = data.map((v, i) => ({ i, v }));
  const domainMax = Math.max(capacity, 1, ...data);
  return (
    <div className="h-10 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, domainMax]} />
          <Area
            dataKey="v"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
