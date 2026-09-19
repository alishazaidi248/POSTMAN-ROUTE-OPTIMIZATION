import { create } from "zustand";
import { AuthUser, LoginRequest, Session } from "../types/auth";
import { authApi } from "../api/authApi";
import { secureStorage } from "../storage/secureStorage";
import { setUnauthorizedHandler } from "../api/axiosClient";
import { offlineStorage } from "../storage/offlineStorage";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
  error: string | null;
  hydrate: () => Promise<void>;
  login: (payload: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

async function persistSession(session: Session): Promise<void> {
  await secureStorage.saveTokens(session.accessToken, session.refreshToken);
  await secureStorage.saveUser(JSON.stringify(session.user));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  error: null,

  hydrate: async () => {
    const [token, userJson] = await Promise.all([secureStorage.getAccessToken(), secureStorage.getUser()]);
    if (!token || !userJson) {
      set({ status: "signedOut", user: null });
      return;
    }
    try {
      const user: AuthUser = JSON.parse(userJson);
      set({ status: "signedIn", user });
    } catch {
      await secureStorage.clear();
      set({ status: "signedOut", user: null });
    }
  },

  login: async (payload) => {
    set({ error: null });
    try {
      const response = await authApi.login(payload);
      if (response.user.role !== "POSTMAN") {
        throw new Error("This app is for delivery postmen only. Please use an account with the Postman role.");
      }
      if (!response.user.postmanId) {
        throw new Error("This account is not yet linked to a Postman profile. Contact your post office admin.");
      }
      await persistSession(response);
      set({ status: "signedIn", user: response.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      set({ error: message });
      throw err;
    }
  },

  logout: async () => {
    const refreshToken = await secureStorage.getRefreshToken();
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // Best-effort server-side revoke; proceed with local cleanup regardless.
    }
    await secureStorage.clear();
    await offlineStorage.clearAll();
    set({ status: "signedOut", user: null });
  }
}));

setUnauthorizedHandler(() => {
  useAuthStore.setState({ status: "signedOut", user: null });
});
