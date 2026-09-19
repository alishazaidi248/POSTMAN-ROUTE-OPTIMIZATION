import { axiosClient } from "./axiosClient";
import { LocationPingRequest } from "../types/location";

export const locationApi = {
  async sendPing(payload: LocationPingRequest): Promise<{ id: string; recordedAt: string }> {
    const { data } = await axiosClient.post("/me/location", payload);
    return data;
  }
};
