import { axiosClient } from "./axiosClient";
import { ActiveRouteResponse, ReoptimizeTrigger, RouteResponse } from "../types/route";

export const routeApi = {
  async getCurrentRoute(): Promise<RouteResponse> {
    const { data } = await axiosClient.get<RouteResponse>("/me/route");
    return data;
  },
  async reoptimize(trigger: ReoptimizeTrigger): Promise<ActiveRouteResponse | { route: null; message: string }> {
    const { data } = await axiosClient.post("/me/route/reoptimize", { trigger });
    return data;
  }
};
