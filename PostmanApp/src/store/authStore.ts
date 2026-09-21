import { setLastFix } from "../services/lastFix";
import { unregisterPushToken } from "../services/notificationService";
import { create } from "zustand";
import { AuthUser, LoginRequest, Session } from "../types/auth";
import { authApi } from "../api/authApi";
import { secureStorage } from "../storage/secureStorage";
import { setUnauthorizedHandler } from "../api/axiosClient";
import { offlineStorage } from "../storage/offlineStorage";
import { useOfflineStore } from "./offlineStore";
import { clearServerCache } from "../lib/queryClient";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
  error: string | null;
  hydrate: () => Promise<void>;
  login: (payload: LoginRequest) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** Wipes everything on the device that belongs to the previous account. */
async function discardAccountData(): Promise<void> {
  clearServerCache();
  setLastFix(null); // the previous account's position must not start the next account's route
  await offlineStorage.clearAll();
  useOfflineStore.setState({ queue: [], conflicts: [] });
}

/**
 * Identity is decided by the SERVER: the user stored on the device is only a
 * convenience for opening offline. This throws unless the account is a POSTMAN
 * linked to a Postman profile.
 */
function assertUsablePostman(user: AuthUser): void {
  if (user.role !== "POSTMAN") {
    throw new Error("This app is for delivery postmen only. Please use an account with the Postman role.");
  }
  if (!user.postmanId) {
    throw new Error("This account is not yet linked to a Postman profile. Contact your post office admin.");
  }
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
    let cached: AuthUser;
    try {
      cached = JSON.parse(userJson);
    } catch {
      await secureStorage.clear();
      set({ status: "signedOut", user: null });
      return;
    }

    // Open immediately (works offline) ...
    set({ status: "signedIn", user: cached });

    // ... then ask the server who this really is. A disabled account, a changed role or
    // an unlinked profile is caught here; a network failure simply keeps the cached user.
    try {
      const fresh = await authApi.me();
      assertUsablePostman(fresh);
      await secureStorage.saveUser(JSON.stringify(fresh));
      set({ user: fresh });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      const isNetwork = (err as { isNetworkError?: boolean }).isNetworkError;
      if (isNetwork) return;
      if (status === 401) return; // axiosClient already signed the user out
      await secureStorage.clear();
      await discardAccountData();
      set({ status: "signedOut", user: null, error: err instanceof Error ? err.message : null });
    }
  },

  login: async (payload) => {
    set({ error: null });
    try {
      const response = await authApi.login(payload);
      // The tokens must be saved before the next call: the API client reads them from storage.
      await secureStorage.saveTokens(response.accessToken, response.refreshToken);

      let me: AuthUser;
      try {
        me = await authApi.me();
        assertUsablePostman(me);
      } catch (err) {
        await authApi.logout(response.refreshToken).catch(() => undefined);
        await secureStorage.clear();
        throw err;
      }

      // Cached data / queued changes from a DIFFERENT account must never reach this one.
      const owner = await offlineStorage.getOwner();
      if (owner !== me.id) await discardAccountData();
      await offlineStorage.setOwner(me.id);
      clearServerCache();

      const session: Session = { accessToken: response.accessToken, refreshToken: response.refreshToken, user: me };
      await secureStorage.saveUser(JSON.stringify(session.user));
      set({ status: "signedIn", user: me });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      set({ error: message });
      throw err;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const tokens = await authApi.changePassword(currentPassword, newPassword);
    await secureStorage.saveTokens(tokens.accessToken, tokens.refreshToken);
    const me = await authApi.me();
    await secureStorage.saveUser(JSON.stringify(me));
    set({ user: me });
  },

  logout: async () => {
    // Stop pushes to this phone while the login is still valid for the call.
    await unregisterPushToken();
    const refreshToken = await secureStorage.getRefreshToken();
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // Best-effort server-side revoke; proceed with local cleanup regardless.
    }
    await secureStorage.clear();
    await discardAccountData();
    set({ status: "signedOut", user: null });
  }
}));

setUnauthorizedHandler(() => {
  // The session ended on the server side: also drop what the last account had cached.
  clearServerCache();
  useAuthStore.setState({ status: "signedOut", user: null });
});
