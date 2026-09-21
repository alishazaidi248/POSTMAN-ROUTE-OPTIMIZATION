import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({ notify: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));

import { NextStopBanner } from "../../src/components/map/NextStopBanner";
import { SelectedDeliverySheet } from "../../src/components/map/SelectedDeliverySheet";
import { RouteSummaryCard } from "../../src/components/route/RouteSummaryCard";
import { openNavigation } from "../../src/utils/navigation";
import { buildStopViews, findNextStop } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

const route = makeRoute([makeStop("a", 1), makeStop("b", 2)]);
const views = buildStopViews([makeDelivery("a", "OUT_FOR_DELIVERY"), makeDelivery("b")], route);

function withClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("NextStopBanner — 'what is next, how far, how do I get there?'", () => {
  it("shows the next stop's number, recipient, address, distance/time and ETA", () => {
    render(
      <NextStopBanner
        next={findNextStop(views)}
        total={2}
        allDone={false}
        recalculating={false}
        onRecalculate={jest.fn()}
        onFocusNext={jest.fn()}
      />
    );

    expect(screen.getByText("NEXT — STOP 1 OF 2")).toBeTruthy();
    expect(screen.getByText("Recipient a")).toBeTruthy();
    expect(screen.getByText(/a Station Road/)).toBeTruthy();
    expect(screen.getByText(/1\.2 km · 3m · ETA/)).toBeTruthy();
  });

  it("navigates to the next stop's coordinates", async () => {
    render(
      <NextStopBanner next={findNextStop(views)} total={2} allDone={false} recalculating={false} onRecalculate={jest.fn()} onFocusNext={jest.fn()} />
    );
    fireEvent.press(screen.getByLabelText("Navigate"));
    await waitFor(() => expect(openNavigation).toHaveBeenCalled());
    const target = (openNavigation as jest.Mock).mock.calls[0][0];
    expect(target.latitude).toBeCloseTo(19.15, 6);
    expect(target.longitude).toBeCloseTo(72.94, 6);
  });

  it("focuses the map on the next stop and can recalculate the route", () => {
    const onFocusNext = jest.fn();
    const onRecalculate = jest.fn();
    render(
      <NextStopBanner next={findNextStop(views)} total={2} allDone={false} recalculating={false} onRecalculate={onRecalculate} onFocusNext={onFocusNext} />
    );
    fireEvent.press(screen.getByLabelText(/Next stop Recipient a/));
    fireEvent.press(screen.getByLabelText("Recalculate route"));
    expect(onFocusNext).toHaveBeenCalledTimes(1);
    expect(onRecalculate).toHaveBeenCalledTimes(1);
  });

  it("celebrates when the round is finished", () => {
    render(<NextStopBanner next={null} total={2} allDone recalculating={false} onRecalculate={jest.fn()} onFocusNext={jest.fn()} />);
    expect(screen.getByText(/All deliveries on this round are done/)).toBeTruthy();
    expect(screen.queryByLabelText("Navigate")).toBeNull();
  });
});

describe("SelectedDeliverySheet — a delivery picked on the map", () => {
  it("shows the delivery, and offers the same Navigate / Mark Delivered as the card", () => {
    const view = views[0]; // OUT_FOR_DELIVERY
    const onClose = jest.fn();
    const onOpenDetails = jest.fn();
    withClient(<SelectedDeliverySheet view={view} onClose={onClose} onOpenDetails={onOpenDetails} />);

    expect(screen.getByText(/#1/)).toBeTruthy();
    expect(screen.getByText("Out for Delivery")).toBeTruthy();
    expect(screen.getByText("Parcels: 2 · Speed Post · Priority: NORMAL")).toBeTruthy();
    expect(screen.getByLabelText("Navigate")).toBeTruthy();
    expect(screen.getByLabelText("Mark Delivered")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Close"));
    fireEvent.press(screen.getByLabelText("Open full details"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});

describe("RouteSummaryCard (Map tab, compact)", () => {
  it("shows progress, distance and time on one line, plus the road-route disclosure when needed", () => {
    render(
      <RouteSummaryCard
        compact
        route={route}
        completed={1}
        total={4}
        currentStop={null}
        nextStop={null}
        recipientNameByDeliveryId={{}}
        hasRoadGeometry={false}
      />
    );
    expect(screen.getByText(/1 of 4 done · 3 to go · 8\.1 km/)).toBeTruthy();
    expect(screen.getByText(/Road route unavailable/)).toBeTruthy();
  });

  it("hides the disclosure when the line is a real road route", () => {
    render(
      <RouteSummaryCard compact route={route} completed={0} total={2} currentStop={null} nextStop={null} recipientNameByDeliveryId={{}} hasRoadGeometry />
    );
    expect(screen.queryByText(/Road route unavailable/)).toBeNull();
  });
});
