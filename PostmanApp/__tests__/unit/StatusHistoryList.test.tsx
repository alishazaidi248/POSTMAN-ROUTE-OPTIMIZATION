import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StatusHistoryList } from "../../src/components/delivery/StatusHistoryList";
import { formatDateTime } from "../../src/utils/formatting";
import { DeliveryStatusHistoryEntry } from "../../src/types/delivery";

const entry = (id: string, toStatus: DeliveryStatusHistoryEntry["toStatus"], createdAt: string, reason: string | null = null): DeliveryStatusHistoryEntry => ({
  id,
  fromStatus: null,
  toStatus,
  reason,
  changedBy: "8f14e45f-ceea-467a-9b3c-5d2e0a9f7c11",
  createdAt
});

describe("StatusHistoryList", () => {
  const now = new Date().toISOString();

  it("names the person being delivered to on every row, with what happened", () => {
    render(
      <StatusHistoryList
        recipientName="Vikas Patil"
        entries={[entry("1", "DELIVERED", now), entry("2", "OUT_FOR_DELIVERY", now)]}
      />
    );
    expect(screen.getAllByText("Vikas Patil")).toHaveLength(2);
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Out for Delivery")).toBeTruthy();
  });

  it("shows the reason the postman gave, and never an internal id", () => {
    render(<StatusHistoryList recipientName="Vikas Patil" entries={[entry("1", "RECIPIENT_UNAVAILABLE", now, "not home")]} />);
    expect(screen.getByText("not home")).toBeTruthy();
    expect(screen.queryByText(/8f14e45f/)).toBeNull();
  });

  it("shows when it happened as a date and time, not only 'x ago'", () => {
    render(<StatusHistoryList recipientName="Vikas Patil" entries={[entry("1", "DELIVERED", now)]} />);
    expect(screen.getByText(formatDateTime(now))).toBeTruthy();
    expect(formatDateTime(now)).toMatch(/^Today, /);
  });
});

describe("formatDateTime", () => {
  const noon = new Date(2026, 8, 21, 12, 0, 0);
  it("says Today, Yesterday, then the date", () => {
    expect(formatDateTime(new Date(2026, 8, 21, 9, 5).toISOString(), noon)).toMatch(/^Today, /);
    expect(formatDateTime(new Date(2026, 8, 20, 23, 50).toISOString(), noon)).toMatch(/^Yesterday, /);
    expect(formatDateTime(new Date(2026, 8, 10, 9, 5).toISOString(), noon)).toMatch(/^(?!Today|Yesterday)(?:.*[^0-9])?10([^0-9]).*,/); // the calendar date; the month name follows the device language
  });
});
