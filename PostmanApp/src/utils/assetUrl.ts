import { env } from "../config/env";

/**
 * The API returns a picture's address as a path ("/uploads/profile/abc.jpg"). Images are served by the
 * same server as the API, so the path is made absolute against the API's origin.
 */
export function resolveAssetUrl(url: string | null | undefined, apiBaseUrl: string = env.apiBaseUrl): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return null;
  const origin = apiBaseUrl.replace(/\/api\/v\d+\/?$/, "").replace(/\/+$/, "");
  return `${origin}${url}`;
}
