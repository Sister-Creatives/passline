/**
 * Format integer minor units (cents) as a currency string. Locale is pinned to
 * en-US for a deterministic dashboard display; per-locale formatting is a later
 * i18n concern.
 */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
