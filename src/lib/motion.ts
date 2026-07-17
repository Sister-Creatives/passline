import type { Transition } from "motion/react";

/**
 * Apple-style spring presets for the Motion library.
 *
 * Critically damped (no overshoot) by default; bounce is reserved for motion
 * that follows a gesture carrying momentum (a flick, a drag release). Response
 * ("duration" here) sits in Apple's 0.3–0.4s range. Mirror the CSS easing
 * tokens in styles.css (--ease-*) so JS and CSS motion feel like one system.
 */
export const spring = {
  /** Default UI move / reposition — graceful, non-distracting, no overshoot. */
  default: { type: "spring", bounce: 0, duration: 0.4 },
  /** Snappy state change (small elements, list settle). */
  snappy: { type: "spring", bounce: 0, duration: 0.3 },
  /** Drawer / sheet — a touch of settle. */
  drawer: { type: "spring", bounce: 0.15, duration: 0.35 },
  /** Momentum / flick — a little overshoot because a gesture preceded it. */
  bouncy: { type: "spring", bounce: 0.28, duration: 0.5 },
} satisfies Record<string, Transition>;

/** Duration tokens in seconds, mirroring the CSS --duration-* scale. */
export const dur = {
  fast: 0.15,
  base: 0.2,
  modal: 0.3,
  drawer: 0.35,
} as const;

/**
 * Enter/exit variants for content that swaps in (result cards, confirmations).
 * Scale from 0.95 — never 0 — and fade, so the surface materialises rather
 * than popping. Pair with the `snappy` spring.
 */
export const popIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
} as const;
