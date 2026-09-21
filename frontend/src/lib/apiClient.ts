import axios from "axios";

export const apiClient = axios.create({ baseURL: "/api/v1" });

let accessToken: string | null = localStorage.getItem("accessToken");
let refreshToken: string | null = localStorage.getItem("refreshToken");

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  if (tokens) {
    localStorage.setItem("accessToken", tokens.accessToken);
    localStorage.setItem("refreshToken", tokens.refreshToken);
  } else {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  }
}

apiClient.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && refreshToken && !original._retry) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post("/api/v1/auth/refresh", { refreshToken })
            .then((res) => {
              setTokens(res.data);
              return res.data.accessToken as string;
            })
            .finally(() => {
              refreshPromise = null;
            });
        }
        const newAccessToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(original);
      } catch (refreshError: any) {
        const status = refreshError?.response?.status;
        if (status === 400 || status === 401 || status === 403) {
          // The refresh token was really rejected: the session is over.
          setTokens(null);
          window.location.href = "/login";
        }
        // Server unreachable / restarting: keep the session and let the caller retry.
      }
    }
    return Promise.reject(error);
  }
);
