import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { secureStorage } from "../storage/secureStorage";
import { ApiError } from "../types/api";
import type { RefreshResponse } from "../types/auth";

export const axiosClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 15000
});

let onUnauthorized: (() => void) | null = null;

/** Wired up once from authStore at app start so a hard 401 (refresh also
 * failed) can force a logout without this module depending on the store. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

axiosClient.interceptors.request.use(async (config) => {
  const token = await secureStorage.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await secureStorage.getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await axios.post<RefreshResponse>(`${env.apiBaseUrl}/auth/refresh`, { refreshToken });
    await secureStorage.saveTokens(response.data.accessToken, response.data.refreshToken);
    return response.data.accessToken;
  } catch {
    return null;
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

axiosClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!error.response) {
      return Promise.reject(new ApiError("Network unavailable. Check your connection and try again.", 0, undefined, true));
    }

    const config = error.config as RetriableConfig | undefined;
    const status = error.response.status;

    if (status === 401 && config && !config._retried && !config.url?.includes("/auth/")) {
      config._retried = true;
      // A single in-flight refresh is shared across concurrently-failing
      // requests so a burst of 401s doesn't rotate the refresh token more
      // than once (rotation is one-time-use on the backend).
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      if (newToken) {
        config.headers.Authorization = `Bearer ${newToken}`;
        return axiosClient(config);
      }
      await secureStorage.clear();
      onUnauthorized?.();
    }

    const body = error.response.data as { message?: string; details?: unknown } | undefined;
    return Promise.reject(new ApiError(body?.message ?? "Something went wrong. Please try again.", status, body?.details));
  }
);
