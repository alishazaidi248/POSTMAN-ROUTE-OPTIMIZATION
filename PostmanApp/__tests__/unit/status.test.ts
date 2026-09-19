import { allowedNextStatuses, canTransition, matchesFilter, statusLabel } from "../../src/utils/status";

describe("delivery status transitions", () => {
  it("allows OUT_FOR_DELIVERY to transition to DELIVERED", () => {
    expect(canTransition("OUT_FOR_DELIVERY", "DELIVERED")).toBe(true);
  });

  it("rejects an arbitrary/invalid transition", () => {
    expect(canTransition("DELIVERED", "OUT_FOR_DELIVERY")).toBe(false);
    expect(canTransition("RECEIVED", "DELIVERED")).toBe(false);
  });

  it("has no outgoing transitions for terminal statuses", () => {
    expect(allowedNextStatuses("DELIVERED")).toEqual([]);
    expect(allowedNextStatuses("CANCELLED")).toEqual([]);
    expect(allowedNextStatuses("RETURNED")).toEqual([]);
  });

  it("produces a human label for every status", () => {
    expect(statusLabel("OUT_FOR_DELIVERY")).toBe("Out for Delivery");
    expect(statusLabel("RECIPIENT_UNAVAILABLE")).toBe("Recipient Unavailable");
  });
});

describe("delivery filters", () => {
  it("matches PENDING for active, non-terminal statuses", () => {
    expect(matchesFilter("ASSIGNED", "PENDING")).toBe(true);
    expect(matchesFilter("OUT_FOR_DELIVERY", "PENDING")).toBe(true);
    expect(matchesFilter("DELIVERED", "PENDING")).toBe(false);
    expect(matchesFilter("FAILED", "PENDING")).toBe(false);
  });

  it("matches COMPLETED only for DELIVERED", () => {
    expect(matchesFilter("DELIVERED", "COMPLETED")).toBe(true);
    expect(matchesFilter("RETURNED", "COMPLETED")).toBe(false);
  });

  it("matches FAILED for failure-like statuses", () => {
    expect(matchesFilter("FAILED", "FAILED")).toBe(true);
    expect(matchesFilter("WRONG_ADDRESS", "FAILED")).toBe(true);
    expect(matchesFilter("DELIVERED", "FAILED")).toBe(false);
  });

  it("ALL matches every status", () => {
    expect(matchesFilter("RECEIVED", "ALL")).toBe(true);
    expect(matchesFilter("CANCELLED", "ALL")).toBe(true);
  });
});
