import type { ReactNode } from "react";

/**
 * Shared "premium dark" primitives for the event-day kiosk pages (door + scan).
 * They stay on the app's tokens (primary accent, semantic surfaces) so the
 * elevated look reads as part of the product, not a one-off theme — depth comes
 * from a soft top glow, layered surfaces, an accent-glow meter, and a tighter
 * type scale rather than new colors or fonts.
 */

/**
 * Full-height stage with a subtle primary glow at the top, for kiosk use.
 * Mobile-first: tight padding and full width on a phone, relaxing on larger
 * screens where a narrow reading column reads better.
 */
export function KioskShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(80%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_11%,transparent),transparent)]"
      />
      <div className="relative mx-auto w-full max-w-2xl px-4 py-6 sm:p-8">{children}</div>
    </div>
  );
}

/**
 * Eyebrow (event) + title, an optional live pill, and actions. Mobile-first:
 * the title and actions stack on a phone (actions get a full-width row below
 * the title); on `sm`+ they sit on one line with the actions pushed right.
 */
export function KioskHeader({
  eventTitle,
  title,
  live = false,
  actions,
}: {
  eventTitle?: string;
  title: string;
  live?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eventTitle ? (
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {eventTitle}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {live ? <LivePill /> : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      Live
    </span>
  );
}

/**
 * The hero metric: an accent icon chip, a big count over a muted total, and a
 * glowing progress meter. `percent` drives both the meter width and its glow.
 */
export function StatMeterCard({
  icon,
  label,
  value,
  total,
  percent,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  total: number;
  percent: number;
  sub: string;
}) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      {/* hairline top sheen — the small detail that reads as "elevated" */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-6">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-4xl font-bold leading-none tabular-nums">
            {value}
            <span className="text-2xl font-medium text-muted-foreground"> / {total}</span>
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_10px] shadow-primary/40 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">{sub}</p>
      </div>
    </div>
  );
}
