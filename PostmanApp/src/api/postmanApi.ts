import { axiosClient } from "./axiosClient";
import { PostmanProfileResponse } from "../types/postman";
import { DeliveryStatsResponse } from "../types/delivery";

export const postmanApi = {
  async getProfile(): Promise<PostmanProfileResponse> {
    const { data } = await axiosClient.get<PostmanProfileResponse>("/me/profile");
    return data;
  },
  async getStats(): Promise<DeliveryStatsResponse> {
    const { data } = await axiosClient.get<DeliveryStatsResponse>("/me/stats");
    return data;
  }
};
