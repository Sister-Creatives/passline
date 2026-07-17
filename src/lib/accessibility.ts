import {
  Accessibility as WheelchairIcon,
  Captions,
  Ear,
  HandHelping,
  ParkingCircle,
  PawPrint,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared metadata for the F15 accessibility flags (icon + label), keyed by
 * the boolean field name on `eventContent.accessibility`. Used by both the
 * organizer's AccessibilityPanel checklist and the public event page's
 * Accessibility section so the two stay in lockstep.
 */
export type AccessibilityFeatureKey =
  | "wheelchairAccessible"
  | "signLanguage"
  | "closedCaptions"
  | "hearingLoop"
  | "accessibleParking"
  | "assistanceAnimalsWelcome";

export const ACCESSIBILITY_FEATURES: {
  key: AccessibilityFeatureKey;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "wheelchairAccessible", label: "Wheelchair accessible", icon: WheelchairIcon },
  { key: "signLanguage", label: "Sign language interpretation", icon: HandHelping },
  { key: "closedCaptions", label: "Closed captions", icon: Captions },
  { key: "hearingLoop", label: "Hearing loop", icon: Ear },
  { key: "accessibleParking", label: "Accessible parking", icon: ParkingCircle },
  { key: "assistanceAnimalsWelcome", label: "Assistance animals welcome", icon: PawPrint },
];
