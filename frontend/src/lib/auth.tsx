import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiClient, setTokens } from "./apiClient";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "POSTMAN";
  postOfficeId: string | null;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      setLoading(false);
      return;
    }
    apiClient
      .get("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => setTokens(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await apiClient.post("/auth/login", { email, password });
    setTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
    setUser(res.data.user);
  }

  async function logout() {
    const refreshToken = localStorage.getItem("refreshToken");
    try {
      if (refreshToken) await apiClient.post("/auth/logout", { refreshToken });
    } finally {
      setTokens(null);
      setUser(null);
    }
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
