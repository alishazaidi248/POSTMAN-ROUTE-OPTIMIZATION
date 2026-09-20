import { useEffect } from "react";
import { Platform } from "react-native";

/**
 * Mobile browsers resize their address/toolbar chrome in and out of the
 * page, but `100%`/`100vh` (what Expo's injected #root/body reset uses,
 * see `node_modules/@expo/cli`'s web template) is computed against the
 * larger *layout* viewport that includes the space the chrome can occupy —
 * not the actually-visible one. The result: our bottom tab bar's last few
 * pixels render below the real fold and are clipped by `body { overflow:
 * hidden }` with no way to scroll to them (exactly the "nav bar barely
 * visible" symptom on phone browsers).
 *
 * Fix: on web only, force #root/body to the *real* visible height
 * (`window.innerHeight`, kept live via resize/visualViewport listeners)
 * instead of trusting `vh`. No-op on native (there's no browser chrome).
 */
export function useFixWebViewportHeight(): void {
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const root = document.getElementById("root");

    function applyHeight() {
      const height = `${window.visualViewport?.height ?? window.innerHeight}px`;
      document.documentElement.style.height = height;
      document.body.style.height = height;
      if (root) root.style.height = height;
    }

    applyHeight();
    window.addEventListener("resize", applyHeight);
    window.visualViewport?.addEventListener("resize", applyHeight);

    return () => {
      window.removeEventListener("resize", applyHeight);
      window.visualViewport?.removeEventListener("resize", applyHeight);
    };
  }, []);
}
