/**
 * The Postman app does not choose, send or show a route algorithm. The backend has exactly one
 * planner (DBSCAN -> Nearest Neighbor -> 2-opt); the app only reports where the postman is,
 * asks for a recalculation, and renders the route the backend returns - in the backend's order.
 */
import fs from "fs";
import path from "path";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";

/* eslint-disable import/first -- jest.mock calls are hoisted above these imports. */
jest.mock("../../src/storage/offlineStorage", () => ({
  offlineStorage: {
    getMutationQueue: jest.fn().mockResolvedValue([]),
    setMutationQueue: jest.fn().mockResolvedValue(undefined),
    getCachedDeliveries: jest.fn(),
    setCachedDeliveries: jest.fn(),
    getCachedRoute: jest.fn(),
    setCachedRoute: jest.fn(),
    clearAll: jest.fn()
  }
}));
jest.mock("../../src/api/deliveryApi", () => ({
  deliveryApi: { updateStatus: jest.fn(), getById: jest.fn(), listMine: jest.fn() }
}));
jest.mock("../../src/api/axiosClient", () => ({
  axiosClient: { get: jest.fn().mockResolvedValue({ data: { route: null } }), post: jest.fn().mockResolvedValue({ data: { routeId: "r" } }) },
  setUnauthorizedHandler: jest.fn()
}));
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({ notify: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));

import { axiosClient } from "../../src/api/axiosClient";
import { routeApi } from "../../src/api/routeApi";
import { DeliveryCard } from "../../src/components/delivery/DeliveryCard";
import { RouteSummaryCard } from "../../src/components/route/RouteSummaryCard";
import { setLastFix } from "../../src/services/lastFix";
import { buildStopViews } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

const SRC = path.resolve(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("no algorithm anywhere in the app", () => {
  it("has no route-method selector component and no algorithm identifiers in its source", () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return /NN_2OPT|DBSCAN|Route method|RouteAlgorithm|algorithmLabel|routeMethod/i.test(
        // The one comment that explains the backend's field is allowed to name it.
        text.replace(/\/\*\*[^*]*\*\//g, "").replace(/\/\/.*$/gm, "")
      )
        ? true
        : false;
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
    expect(fs.existsSync(path.join(SRC, "components/route/RouteAlgorithmToggle.tsx"))).toBe(false);
  });
});

describe("routeApi never sends an algorithm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLastFix(null);
  });

  it("recalculate sends only the trigger (and the GPS start when there is one)", async () => {
    await routeApi.reoptimize("MANUAL");
    expect(axiosClient.post).toHaveBeenCalledWith("/me/route/reoptimize", { trigger: "MANUAL" }, expect.any(Object));

    await routeApi.reoptimize("MANUAL", { latitude: 19.1, longitude: 72.9 });
    expect(axiosClient.post).toHaveBeenLastCalledWith(
      "/me/route/reoptimize",
      { trigger: "MANUAL", start: { latitude: 19.1, longitude: 72.9 } },
      expect.any(Object)
    );
    for (const call of (axiosClient.post as jest.Mock).mock.calls) {
      expect(JSON.stringify(call[1])).not.toMatch(/algorithm/i);
    }
  });

  it("recalculate begins at the device's latest GPS fix when the caller gives none", async () => {
    setLastFix({ latitude: 19.2, longitude: 72.95 });
    await routeApi.reoptimize("MANUAL");
    expect(axiosClient.post).toHaveBeenCalledWith(
      "/me/route/reoptimize",
      { trigger: "MANUAL", start: { latitude: 19.2, longitude: 72.95 } },
      expect.any(Object)
    );
  });

  it("reading the route reports the GPS fix as the start and carries no algorithm parameter", async () => {
    await routeApi.getCurrentRoute();
    expect((axiosClient.get as jest.Mock).mock.calls[0][1].params).toBeUndefined();

    setLastFix({ latitude: 19.2, longitude: 72.95 });
    await routeApi.getCurrentRoute();
    const config = (axiosClient.get as jest.Mock).mock.calls[1][1];
    expect(config.params).toEqual({ startLat: 19.2, startLng: 72.95 });
    expect(JSON.stringify(config)).not.toMatch(/algorithm/i);
    expect((axiosClient.get as jest.Mock).mock.calls[1][0]).toBe("/me/route");
  });
});

describe("what the postman sees", () => {
  const route = makeRoute([makeStop("a", 1, { clusterId: 1 }), makeStop("b", 2, { clusterId: 2 })]);

  it("the route summary says 'Optimized Route' and names no method or cluster", () => {
    render(
      <RouteSummaryCard
        compact
        route={route}
        completed={0}
        total={2}
        currentStop={null}
        nextStop={null}
        recipientNameByDeliveryId={{}}
        hasRoadGeometry
      />
    );
    expect(screen.getByText(/Optimized Route/)).toBeTruthy();
    expect(screen.getByText("Route v1")).toBeTruthy();
    expect(screen.queryByText(/DBSCAN|Nearest|2-opt|cluster|method/i)).toBeNull();
  });

  it("an expanded delivery card shows no cluster field", () => {
    const [view] = buildStopViews([makeDelivery("a")], route);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeliveryCard view={view} expanded onToggle={jest.fn()} onOpenDetails={jest.fn()} />
      </QueryClientProvider>
    );
    expect(screen.queryByText(/cluster/i)).toBeNull();
  });
});

describe("the Deliveries order is the backend's route order", () => {
  it("lists stops by the backend's sequence, whatever order the deliveries arrive in", () => {
    const deliveries = ["c", "a", "d", "b"].map((id) => makeDelivery(id));
    // Backend route: d, b, a, c
    const route = makeRoute([makeStop("d", 1), makeStop("b", 2), makeStop("a", 3), makeStop("c", 4)]);
    const views = buildStopViews(deliveries, route);
    expect(views.map((v) => v.delivery.id)).toEqual(["d", "b", "a", "c"]);
    expect(views.map((v) => v.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("keeps the remaining order (and the original numbers) when a stop is delivered", () => {
    const deliveries = [makeDelivery("d"), makeDelivery("b", "DELIVERED"), makeDelivery("a"), makeDelivery("c")];
    const route = makeRoute([makeStop("d", 1), makeStop("b", 2), makeStop("a", 3), makeStop("c", 4)]);
    const views = buildStopViews(deliveries, route);
    const pending = views.filter((v) => v.state === "NEXT" || v.state === "PENDING");
    expect(pending.map((v) => v.delivery.id)).toEqual(["d", "a", "c"]);
    expect(pending.map((v) => v.sequence)).toEqual([1, 3, 4]);
  });
});
