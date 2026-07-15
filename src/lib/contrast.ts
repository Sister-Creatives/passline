/**
 * Picks a readable foreground color for text placed on an arbitrary
 * organizer-supplied background hex color, using the YIQ perceived-brightness
 * formula. Falls back to white text when the input isn't a valid "#RRGGBB"
 * hex string.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "#ffffff";
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#000000" : "#ffffff";
}
