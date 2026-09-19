import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";

export function useAuth() {
  const { status, user, error, login, logout, hydrate } = useAuthStore();

  useEffect(() => {
    if (status === "loading") {
      hydrate();
    }
    // Only run once on mount; status is re-checked via the condition above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, user, error, login, logout };
}
