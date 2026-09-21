import { axiosClient } from "./axiosClient";

export interface AppNotification {
  id: string;
  title?: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  readAt: string | null;
  createdAt: string;
}

export const notificationApi = {
  async list(): Promise<AppNotification[]> {
    const { data } = await axiosClient.get<AppNotification[]>("/notifications");
    return data;
  },
  async markRead(id: string): Promise<void> {
    await axiosClient.post(`/notifications/${id}/read`);
  },
  async markAllRead(): Promise<void> {
    await axiosClient.post("/notifications/read-all");
  },
  /** The server files the token under the signed-in login; the phone never says whose it is. */
  async registerPushToken(token: string, platform: "ios" | "android" | "web"): Promise<void> {
    await axiosClient.post("/me/push-token", { token, platform });
  },
  async unregisterPushToken(token: string): Promise<void> {
    await axiosClient.delete("/me/push-token", { data: { token } });
  }
};
