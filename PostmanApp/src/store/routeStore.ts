import { create } from "zustand";
import { ActiveRouteResponse } from "../types/route";

interface RouteState {
  activeRoute: ActiveRouteResponse | null;
  selectedDeliveryId: string | null;
  setActiveRoute: (route: ActiveRouteResponse | null) => void;
  selectDelivery: (deliveryId: string | null) => void;
}

/**
 * UI-only mirror of the current route (which version is on screen, which
 * stop is selected on the map). The route *data* itself is server state
 * owned by TanStack Query (see hooks/useRoute.ts) — this store never fetches.
 */
export const useRouteStore = create<RouteState>((set) => ({
  activeRoute: null,
  selectedDeliveryId: null,
  setActiveRoute: (route) => set({ activeRoute: route }),
  selectDelivery: (deliveryId) => set({ selectedDeliveryId: deliveryId })
}));
