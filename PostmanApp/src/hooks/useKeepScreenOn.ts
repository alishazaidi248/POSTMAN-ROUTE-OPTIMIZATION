import { useEffect } from "react";

type KeepAwake = typeof import("expo-keep-awake");

/**
 * Keeps the screen on while the calling screen is mounted. expo-keep-awake throws on import when its native code is
 * missing from the installed build (a development build made before it was a direct dependency), so it is loaded
 * defensively: on such a build the screen may dim, and nothing else changes.
 */
export function useKeepScreenOn(tag: string) {
  useEffect(() => {
    let keepAwake: KeepAwake;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      keepAwake = require("expo-keep-awake") as KeepAwake;
    } catch {
      return;
    }
    keepAwake.activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      keepAwake.deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [tag]);
}
