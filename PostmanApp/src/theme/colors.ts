// A calm, professional logistics palette: white surfaces, cool neutral greys, ONE brand colour (postal red)
// for the primary action and the active state, and clear semantic colours for delivery status. Kept flat (no
// dark-mode toggle): a field tool used outdoors in daylight needs contrast and legibility more than theming.
export const colors = {
  primary: "#B3202A",
  primaryDark: "#8E1821",
  primarySoft: "#FBEEEE",
  onPrimary: "#FFFFFF",

  background: "#F5F6F8",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  divider: "#EEF0F3",

  textPrimary: "#111827",
  textSecondary: "#4B5563",
  textDisabled: "#9CA3AF",

  success: "#1E7A55",
  successBg: "#E7F4EE",
  warning: "#94620A",
  warningBg: "#FDF3DC",
  danger: "#B42318",
  dangerBg: "#FDECEA",
  info: "#1D5F8F",
  infoBg: "#E8F1F8",
  neutral: "#4B5563",
  neutralBg: "#EEF0F3",

  mapPending: "#B5720B",
  mapCompleted: "#1E7A55",
  mapFailed: "#B42318",
  mapCurrent: "#1D5FB3",
  mapSelf: "#111827"
} as const;

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";
