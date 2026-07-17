/**
 * Audio + haptic feedback for door/scan commits.
 *
 * On a heads-down door surface the operator often isn't watching the screen,
 * so a purely visual result is easy to miss. Audio is the primary channel
 * (iOS Safari has no Vibration API); haptics augment it where supported. A
 * single AudioContext is created lazily and resumed on use — browsers require
 * a user gesture to start audio, and the scan submit is exactly that gesture.
 */
type Signal = "success" | "warn" | "error";

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Plays one short sine blip with a crisp attack/decay envelope (no click). */
function blip(freq: number, startOffset: number, duration: number) {
  const audio = getContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = audio.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.16, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// [frequency Hz, start offset s, duration s]
const PATTERNS: Record<
  Signal,
  { tones: Array<[number, number, number]>; vibrate: number | number[] }
> = {
  success: { tones: [[880, 0, 0.08]], vibrate: 30 },
  warn: { tones: [[440, 0, 0.07], [440, 0.11, 0.07]], vibrate: [20, 40, 20] },
  error: { tones: [[220, 0, 0.18]], vibrate: [40, 40, 40] },
};

/** Fires the audio + haptic pair for a signal on the same tick. */
export function playScanFeedback(signal: Signal) {
  const pattern = PATTERNS[signal];
  for (const [freq, start, duration] of pattern.tones) blip(freq, start, duration);
  if (typeof navigator !== "undefined") navigator.vibrate?.(pattern.vibrate);
}

/** Maps a scan / check-in result string to its feedback signal. */
export function signalForResult(result: string): Signal {
  if (result === "ok" || result === "checked_in") return "success";
  if (result === "already" || result === "not_in") return "warn";
  return "error"; // cancelled, not_found, not_confirmed, and any unknown
}
