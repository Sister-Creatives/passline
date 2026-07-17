/**
 * Picks the more readable of black/white text for an arbitrary
 * organizer-supplied background hex color, using the WCAG sRGB relative
 * luminance formula and returning whichever foreground yields the higher
 * contrast ratio (guaranteeing the better of the two, never below ~4.5:1 for
 * mid-tones). Falls back to white text when the input isn't a valid
 * "#RRGGBB" hex string.
 */
export function readableTextColor(hex: string): "#000000" | "#ffffff" {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "#ffffff";
  const value = match[1];
  // Linearise each sRGB channel, then weight by the luminous efficiency curve.
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(parseInt(value.slice(0, 2), 16));
  const g = toLinear(parseInt(value.slice(2, 4), 16));
  const b = toLinear(parseInt(value.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast ratios (lighter + 0.05) / (darker + 0.05) against pure black/white.
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff";
}
