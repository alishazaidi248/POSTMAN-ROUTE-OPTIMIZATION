import { axiosClient } from "./axiosClient";
import { Delivery, DeliveryListResponse, DeliveryStatus } from "../types/delivery";

export const deliveryApi = {
  async listMine(status?: DeliveryStatus): Promise<DeliveryListResponse> {
    const { data } = await axiosClient.get<DeliveryListResponse>("/me/deliveries", {
      params: status ? { status, pageSize: 100 } : { pageSize: 100 }
    });
    return data;
  },
  async getById(id: string): Promise<Delivery> {
    const { data } = await axiosClient.get<Delivery>(`/deliveries/${id}`);
    return data;
  },
  async updateStatus(id: string, status: DeliveryStatus, reason?: string): Promise<Delivery> {
    const { data } = await axiosClient.post<Delivery>(`/deliveries/${id}/status`, { status, reason });
    return data;
  }
};
