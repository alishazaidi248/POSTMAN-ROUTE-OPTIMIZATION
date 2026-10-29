/** True when an Origin is served from this machine (localhost) or a private LAN address (10/8, 172.16/12,
 * 192.168/16). Used outside production so the Postman app opened at the dev machine's LAN IP can call the
 * API without CORS_ORIGIN being edited every time that IP changes. */
export function isLocalNetworkOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
