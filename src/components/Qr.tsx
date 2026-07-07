import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

interface QrProps {
  /** The string encoded into the QR code, e.g. a ticket token. */
  value: string;
  /** Rendered width/height in pixels. */
  size?: number;
}

/**
 * Renders `value` as a scannable QR code image.
 *
 * `qrcode`'s `toDataURL` is async and (in its default configuration) touches
 * a canvas, so generation happens client-side inside an effect rather than
 * during render -- this avoids SSR canvas issues on this route. Nothing (a
 * skeleton) renders until the data URL is ready.
 */
export function Qr({ value, size = 200 }: QrProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // Swallow: an unreadable QR just falls back to the skeleton below.
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse rounded-md bg-muted"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="QR code for this ticket, scan at the door to check in"
      width={size}
      height={size}
      className="rounded-md"
    />
  );
}
