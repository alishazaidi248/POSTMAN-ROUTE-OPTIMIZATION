import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, setTokens } from "./apiClient";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "POSTMAN";
  postOfficeId: string | null;
  postOfficeName?: string | null;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  /** Set when the saved session could not be checked because the server was unreachable
   * (as opposed to the session being rejected). The tokens are kept; retry() tries again. */
  bootError: string | null;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state only. Everything else the panel shows (beats, postmen, deliveries,
 * ...) is business data that lives in PostgreSQL and is fetched through TanStack
 * Query after this establishes WHO is signed in - login itself returns no data.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    if (!localStorage.getItem("accessToken")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setBootError(null);
    try {
      // Identity always comes from the server, never from what was saved in the browser.
      const res = await apiClient.get("/auth/me");
      setUser(res.data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // The server actually rejected the session (expired and not renewable, disabled account).
        setTokens(null);
      } else {
        // The server is down or restarting. That is NOT a reason to sign the user out.
        setBootError("Cannot reach the server right now. Your data is safe on the server - try again in a moment.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function login(email: string, password: string) {
    const res = await apiClient.post("/auth/login", { email, password });
    setTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });

    // Login only establishes identity. Ask the server who this is, and reject accounts
    // this panel is not for (postmen use the mobile app).
    const me = await apiClient.get("/auth/me");
    if (me.data.role === "POSTMAN") {
      const refreshToken = res.data.refreshToken;
      await apiClient.post("/auth/logout", { refreshToken }).catch(() => undefined);
      setTokens(null);
      throw new Error("This panel is for post office staff. Postmen sign in with the Postman app.");
    }

    // Nothing from a previous session may be shown to this one.
    queryClient.clear();
    setBootError(null);
    setUser(me.data);
  }

  async function logout() {
    const refreshToken = localStorage.getItem("refreshToken");
    try {
      if (refreshToken) await apiClient.post("/auth/logout", { refreshToken });
    } finally {
      setTokens(null);
      queryClient.clear();
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, bootError, retry: () => void bootstrap(), login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
