// Government/public-service inspired palette: red/white primary, neutral
// grays, and clear semantic colors for delivery status. Kept flat (no dark
// mode toggle) since this is a single-purpose field-worker tool used
// outdoors in daylight — contrast and legibility matter more than theming.
export const colors = {
  primary: "#B3131C",
  primaryDark: "#7E0D14",
  onPrimary: "#FFFFFF",

  background: "#F7F7F8",
  surface: "#FFFFFF",
  border: "#E2E2E5",

  textPrimary: "#1A1A1E",
  textSecondary: "#5B5B63",
  textDisabled: "#9A9AA1",

  success: "#1B7A3D",
  successBg: "#E6F4EA",
  warning: "#B5720B",
  warningBg: "#FBF0DC",
  danger: "#B3131C",
  dangerBg: "#FBE7E8",
  info: "#1B5FB3",
  infoBg: "#E7EFFB",
  neutral: "#5B5B63",
  neutralBg: "#EEEEF0",

  mapPending: "#B5720B",
  mapCompleted: "#1B7A3D",
  mapFailed: "#B3131C",
  mapCurrent: "#1B5FB3",
  mapSelf: "#111827"
} as const;

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";
