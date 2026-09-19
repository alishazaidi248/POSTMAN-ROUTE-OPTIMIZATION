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
  }
  // NOTE: there is no backend endpoint yet to register an Expo push token
  // against a Postman/User record. Until that exists, push notifications
  // stay local-only (see services/notificationService.ts and
  // docs/mobile-architecture.md "Notifications" section).
};
