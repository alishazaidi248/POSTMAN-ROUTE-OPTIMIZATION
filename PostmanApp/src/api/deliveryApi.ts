import { axiosClient } from "./axiosClient";
import { Delivery, DeliveryHistoryResponse, DeliveryListResponse, DeliveryStatus, HistoryOutcome } from "../types/delivery";

export const deliveryApi = {
  async listMine(status?: DeliveryStatus): Promise<DeliveryListResponse> {
    const { data } = await axiosClient.get<DeliveryListResponse>("/me/deliveries", {
      params: status ? { status, pageSize: 100 } : { pageSize: 100 }
    });
    return data;
  },
  /**
   * The postman's past work: deliveries finished before `before` (the start of the device's today) and at or after
   * `since` (omit for all time). The server decides whose deliveries these are from the login, not from anything sent here.
   */
  async listHistory(params: { before: string; since?: string; outcome: HistoryOutcome; page: number; pageSize: number }): Promise<DeliveryHistoryResponse> {
    const { data } = await axiosClient.get<DeliveryHistoryResponse>("/me/deliveries/history", {
      params: {
        before: params.before,
        ...(params.since ? { since: params.since } : {}),
        ...(params.outcome !== "ALL" ? { outcome: params.outcome } : {}),
        page: params.page,
        pageSize: params.pageSize
      }
    });
    return data;
  },
  async getById(id: string): Promise<Delivery> {
    const { data } = await axiosClient.get<Delivery>(`/deliveries/${id}`);
    return data;
  },
  async updateStatus(
    id: string,
    status: DeliveryStatus,
    reason?: string,
    location?: { latitude: number; longitude: number; accuracyMeters?: number }
  ): Promise<Delivery> {
    const { data } = await axiosClient.post<Delivery>(`/deliveries/${id}/status`, { status, reason, ...(location ? { location } : {}) });
    return data;
  },
  /** Sends the proof photo (a file on the device). The server checks it is really an image and keeps it private. */
  async uploadProof(id: string, proof: { uri: string; mimeType?: string; latitude?: number; longitude?: number; capturedAt?: string }): Promise<void> {
    const form = new FormData();
    // React Native's FormData takes a { uri, name, type } descriptor in place of a Blob.
    form.append("photo", { uri: proof.uri, name: "proof.jpg", type: proof.mimeType ?? "image/jpeg" } as unknown as Blob);
    if (proof.latitude !== undefined) form.append("latitude", String(proof.latitude));
    if (proof.longitude !== undefined) form.append("longitude", String(proof.longitude));
    if (proof.capturedAt) form.append("capturedAt", proof.capturedAt);
    await axiosClient.post(`/deliveries/${id}/proof`, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60_000 });
  }
};
