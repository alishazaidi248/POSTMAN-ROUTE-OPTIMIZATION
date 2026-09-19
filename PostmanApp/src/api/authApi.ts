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
  async me(): Promise<AuthUser> {
    const { data } = await axiosClient.get<AuthUser>("/auth/me");
    return data;
  }
};
