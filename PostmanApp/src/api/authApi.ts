import { axiosClient } from "./axiosClient";
import { AuthUser, LoginRequest, LoginResponse } from "../types/auth";

export const authApi = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const { data } = await axiosClient.post<LoginResponse>("/auth/login", payload);
    return data;
  },
  async logout(refreshToken: string): Promise<void> {
    await axiosClient.post("/auth/logout", { refreshToken });
  },
  /** Chooses a new password; the server ends every other session and answers with new, unrestricted tokens. */
  async changePassword(currentPassword: string, newPassword: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { data } = await axiosClient.post<{ accessToken: string; refreshToken: string }>("/auth/change-password", { currentPassword, newPassword });
    return data;
  },
  async me(): Promise<AuthUser> {
    const { data } = await axiosClient.get<AuthUser>("/auth/me");
    return data;
  }
};
