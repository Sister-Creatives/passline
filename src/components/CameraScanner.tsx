import { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Live camera QR scanner. Decodes ticket QR codes and hands the raw string to
 * `onDecode`, which the door/scan pages feed into the same check-in flow the
 * manual field uses. `qr-scanner` is dynamically imported so it stays out of
 * the SSR bundle and only downloads when the camera is actually switched on.
 *
 * Repeated reads of the same code within a short window are dropped, so a QR
 * lingering in frame submits once rather than on every decoded frame. The
 * caller keeps the manual input as the fallback for hardware wedge scanners,
 * denied permission, or unsupported browsers.
 */
export function CameraScanner({
  onDecode,
  className,
}: {
  onDecode: (value: string) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;
    let lastValue = "";
    let lastAt = 0;

    (async () => {
      try {
        const QrScanner = (await import("qr-scanner")).default;
        const video = videoRef.current;
        if (cancelled || !video) return;
        if (!(await QrScanner.hasCamera())) {
          setError("No camera found on this device.");
          return;
        }
        scanner = new QrScanner(
          video,
          (result: { data: string }) => {
            const value = result.data;
            const now = Date.now();
            // Drop a repeat of the same code within 2.5s so one QR held in
            // frame doesn't re-submit every decoded frame.
            if (value === lastValue && now - lastAt < 2500) return;
            lastValue = value;
            lastAt = now;
            onDecodeRef.current(value);
          },
          {
            preferredCamera: "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 5,
            returnDetailedScanResult: true,
          },
        );
        await scanner.start();
        if (cancelled) {
          scanner.stop();
          scanner.destroy();
          scanner = null;
        }
      } catch (err) {
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission denied."
            : "Couldn't start the camera.",
        );
      }
    })();

    return () => {
      cancelled = true;
      if (scanner) {
        scanner.stop();
        scanner.destroy();
      }
    };
  }, []);

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/40 p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        <CameraOff className="size-5" />
        <span>{error}</span>
        <span className="text-xs">Enter the code manually below instead.</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border/60 bg-black sm:aspect-video",
        className,
      )}
    >
      <video ref={videoRef} className="size-full object-cover" playsInline muted />
    </div>
  );
}
