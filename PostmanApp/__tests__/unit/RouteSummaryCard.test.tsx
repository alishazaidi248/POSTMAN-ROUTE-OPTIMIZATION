import React from "react";
import { render, screen } from "@testing-library/react-native";
import { RouteSummaryCard } from "../../src/components/route/RouteSummaryCard";
import { ActiveRouteResponse } from "../../src/types/route";

const route: ActiveRouteResponse = {
  routeId: "r1",
  version: 1,
  trigger: "ROUTE_PLAN",
  status: "COMPLETED",
  generatedAt: "2026-09-20T00:00:00.000Z",
  solution: {
    postmanId: "p1",
    beatId: "b1",
    stops: [],
    totalDistanceMeters: 500,
    estimatedDurationMinutes: 10,
    generatedAt: "2026-09-20T00:00:00.000Z"
  }
};

describe("RouteSummaryCard â€” road route availability disclosure", () => {
  it("shows a 'road route unavailable' warning when hasRoadGeometry is false, and never claims an optimal route", () => {
    render(
      <RouteSummaryCard
        route={route}
        completed={1}
        total={5}
        currentStop={null}
        nextStop={null}
        recipientNameByDeliveryId={{}}
        hasRoadGeometry={false}
      />
    );

    expect(screen.getByText(/Road route unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/optimal route/i)).toBeNull();
  });

  it("does not show the road-route warning once real road geometry is available", () => {
    render(
      <RouteSummaryCard
        route={route}
        completed={1}
        total={5}
        currentStop={null}
        nextStop={null}
        recipientNameByDeliveryId={{}}
        hasRoadGeometry
      />
    );

    expect(screen.queryByText(/Road route unavailable/i)).toBeNull();
  });
});
