import { Linking, Platform } from "react-native";
import { Address } from "../types/delivery";
import { findCoordinateProblems } from "./coordinates";
import { formatAddress } from "./formatting";

export interface NavigationTarget {
  latitude: number | null;
  longitude: number | null;
  address: Address;
  label?: string;
}

export type NavigationPlatform = "ios" | "android" | "web" | "windows" | "macos";

const hasCoordinates = (t: NavigationTarget): t is NavigationTarget & { latitude: number; longitude: number } =>
  findCoordinateProblems(t.latitude, t.longitude).filter((p) => p !== "LIKELY_LAT_LNG_REVERSED").length === 0;

/**
 * The URL that opens turn-by-turn navigation to the delivery, per platform.
 * The destination is always the delivery's real coordinates; if those are
 * unusable it falls back to the written address so the Maps app can search it.
 *
 *   iOS      → Apple Maps  (maps.apple.com, driving directions)
 *   Android  → Google Maps navigation intent (google.navigation:)
 *   other    → Google Maps directions URL (works in any browser / desktop)
 */
export function buildNavigationUrl(target: NavigationTarget, platform: NavigationPlatform): string {
  const query = hasCoordinates(target)
    ? `${target.latitude},${target.longitude}`
    : formatAddress(target.address);
  const encoded = encodeURIComponent(query);

  if (platform === "ios") {
    return `http://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  }
  if (platform === "android") {
    return `google.navigation:q=${encoded}&mode=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
}

/** Always-works browser URL, used when the native intent cannot be opened. */
export function buildWebNavigationUrl(target: NavigationTarget): string {
  return buildNavigationUrl(target, "web");
}

/**
 * Opens navigation to the delivery. Resolves false (never throws) if nothing
 * could handle it. Tries the platform's native URL first and falls back to
 * the Google Maps web URL — deliberately without Linking.canOpenURL, which on
 * Android 11+ reports false for any scheme not pre-declared in the manifest.
 */
export async function openNavigation(target: NavigationTarget): Promise<boolean> {
  const platform = Platform.OS as NavigationPlatform;
  const primary = buildNavigationUrl(target, platform);

  if (Platform.OS === "web") {
    window.open(primary, "_blank", "noopener,noreferrer");
    return true;
  }

  try {
    await Linking.openURL(primary);
    return true;
  } catch {
    try {
      await Linking.openURL(buildWebNavigationUrl(target));
      return true;
    } catch {
      return false;
    }
  }
}
