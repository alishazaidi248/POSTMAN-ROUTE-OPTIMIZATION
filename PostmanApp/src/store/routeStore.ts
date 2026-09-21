import { create } from "zustand";
import { ActiveRouteResponse } from "../types/route";

/** Where the current selection came from — lets each screen react appropriately
 * (the map focuses on list selections; the list scrolls to map selections). */
export type SelectionSource = "list" | "map";

interface RouteState {
  activeRoute: ActiveRouteResponse | null;
  /** The delivery that is expanded in the Deliveries tab AND highlighted on the map. */
  selectedDeliveryId: string | null;
  selectionSource: SelectionSource | null;
  setActiveRoute: (route: ActiveRouteResponse | null) => void;
  selectDelivery: (deliveryId: string | null, source?: SelectionSource) => void;
}

/**
 * UI-only mirror of the current route (which version is on screen, which
 * stop is selected). The route *data* itself is server state owned by
 * TanStack Query (see hooks/useRoute.ts) — this store never fetches.
 */
export const useRouteStore = create<RouteState>((set) => ({
  activeRoute: null,
  selectedDeliveryId: null,
  selectionSource: null,
  setActiveRoute: (route) => set({ activeRoute: route }),
  selectDelivery: (deliveryId, source = "list") =>
    set({ selectedDeliveryId: deliveryId, selectionSource: deliveryId ? source : null })
}));
