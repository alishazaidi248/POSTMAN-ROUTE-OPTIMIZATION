import { axiosClient } from "./axiosClient";
import { Directions, TravelMode } from "../types/navigation";

export const navigationApi = {
  /** Street-by-street directions to one of the postman's deliveries, from `from` (else the server's last known location). */
  async getDirections(deliveryId: string, mode: TravelMode, from: { latitude: number; longitude: number } | null): Promise<Directions> {
    const { data } = await axiosClient.get<Directions>(`/me/navigation/${deliveryId}`, {
      timeout: 20_000,
      params: { mode, ...(from ? { fromLat: from.latitude, fromLng: from.longitude } : {}) }
    });
    return data;
  }
};
