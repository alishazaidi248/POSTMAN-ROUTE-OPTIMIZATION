import { Delivery, DeliveryStatus, ParcelPriority } from "../../src/types/delivery";
import { ActiveRouteResponse, OptimizationStop } from "../../src/types/route";

export function makeDelivery(
  id: string,
  status: DeliveryStatus = "ASSIGNED",
  over: Partial<Delivery> & { lat?: number | null; lng?: number | null; priority?: ParcelPriority } = {}
): Delivery {
  const { lat = 19.15, lng = 72.94, ...rest } = over;
  return {
    id,
    trackingId: `TRK-${id}`,
    recipient: { id: `r-${id}`, name: `Recipient ${id}`, phone: "9820000000", altPhone: null },
    address: {
      id: `a-${id}`,
      addressLine1: `${id} Station Road`,
      addressLine2: null,
      area: "Bhandup West",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400078",
      latitude: lat,
      longitude: lng
    },
    parcelType: "Speed Post",
    parcelCount: 2,
    priority: "NORMAL",
    urgency: null,
    serviceTimeMinutes: null,
    status,
    postOfficeId: "po1",
    beatId: "b1",
    beat: { beatNumber: "B01" },
    assignedPostmanId: "pm1",
    createdAt: "2026-09-20T05:00:00.000Z",
    updatedAt: "2026-09-20T05:00:00.000Z",
    ...rest
  };
}

export function makeStop(deliveryId: string, sequence: number, over: Partial<OptimizationStop> = {}): OptimizationStop {
  return {
    deliveryId,
    sequence,
    latitude: 19.14 + sequence / 100,
    longitude: 72.93 + sequence / 100,
    estimatedArrival: "2026-09-20T08:10:00.000Z",
    distanceFromPreviousMeters: 1200 * sequence,
    travelTimeFromPreviousSeconds: 180 * sequence,
    load: 2,
    priority: "NORMAL",
    ...over
  };
}

export function makeRoute(
  stops: OptimizationStop[],
  over: Partial<ActiveRouteResponse["solution"]> = {}
): ActiveRouteResponse {
  return {
    routeId: "route-1",
    version: 1,
    trigger: "DELIVERIES_CHANGED",
    status: "COMPLETED",
    generatedAt: "2026-09-20T08:00:00.000Z",
    solution: {
      postmanId: "pm1",
      beatId: "b1",
      stops,
      totalDistanceMeters: 8053,
      estimatedDurationMinutes: 40.8,
      generatedAt: "2026-09-20T08:00:00.000Z",
      start: { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" },
      geometry: {
        type: "LineString",
        coordinates: [
          [72.9345, 19.1436],
          [72.94, 19.15],
          [72.95, 19.16]
        ]
      },
      routing: { mode: "ROAD", provider: "osrm", geometrySource: "ROAD", warnings: [] },
      ...over
    }
  };
}
