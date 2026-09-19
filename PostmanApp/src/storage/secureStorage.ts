import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Auth tokens only. Never store the user's password here (spec §26).
const ACCESS_TOKEN_KEY = "postman_access_token";
const REFRESH_TOKEN_KEY = "postman_refresh_token";
const AUTH_USER_KEY = "postman_auth_user";

// expo-secure-store has NO web implementation (its ExpoSecureStore.web.ts is
// a literal empty stub) — calling it on web throws immediately. Browsers
// have no OS keychain equivalent, so this falls back to localStorage on web.
// This is NOT secure storage (any script on the page/origin can read it) —
// it exists only so the web build (a secondary/dev target; this app is
// primarily a native mobile client, see README) doesn't crash on load.
const isWeb = Platform.OS === "web";

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    return window.localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const secureStorage = {
  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await Promise.all([setItem(ACCESS_TOKEN_KEY, accessToken), setItem(REFRESH_TOKEN_KEY, refreshToken)]);
  },
  async getAccessToken(): Promise<string | null> {
    return getItem(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return getItem(REFRESH_TOKEN_KEY);
  },
  async saveUser(userJson: string): Promise<void> {
    await setItem(AUTH_USER_KEY, userJson);
  },
  async getUser(): Promise<string | null> {
    return getItem(AUTH_USER_KEY);
  },
  async clear(): Promise<void> {
    await Promise.all([deleteItem(ACCESS_TOKEN_KEY), deleteItem(REFRESH_TOKEN_KEY), deleteItem(AUTH_USER_KEY)]);
  }
};
