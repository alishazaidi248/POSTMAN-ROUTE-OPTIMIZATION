import { classifyDeliveryStatus, computeDeliveryStats } from "../../src/utils/status";
import { DeliveryStatus } from "../../src/types/delivery";

const ALL_STATUSES: DeliveryStatus[] = [
  "RECEIVED",
  "SORTED",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RECIPIENT_UNAVAILABLE",
  "REJECTED",
  "WRONG_ADDRESS",
  "ADDRESS_NOT_FOUND",
  "RESCHEDULED",
  "RETURNED",
  "FAILED",
  "CANCELLED"
];

function repeat(status: DeliveryStatus, n: number): DeliveryStatus[] {
  return Array.from({ length: n }, () => status);
}

describe("classifyDeliveryStatus", () => {
  it("classifies every known status into exactly one of COMPLETED/FAILED/REMAINING", () => {
    for (const status of ALL_STATUSES) {
      expect(["COMPLETED", "FAILED", "REMAINING"]).toContain(classifyDeliveryStatus(status));
    }
  });

  it("classifies DELIVERED as COMPLETED", () => {
    expect(classifyDeliveryStatus("DELIVERED")).toBe("COMPLETED");
  });

  it("classifies terminal-unsuccessful statuses (RETURNED, CANCELLED) as FAILED, not REMAINING", () => {
    // Business decision documented in src/utils/status.ts and mirrored in
    // backend/src/utils/deliveryStatusClassification.ts: these are terminal
    // (no further transitions in the state machine) and unsuccessful, so
    // they must not be counted as work still remaining.
    expect(classifyDeliveryStatus("RETURNED")).toBe("FAILED");
    expect(classifyDeliveryStatus("CANCELLED")).toBe("FAILED");
  });

  it("classifies in-progress attempt-failure statuses as FAILED", () => {
    expect(classifyDeliveryStatus("REJECTED")).toBe("FAILED");
    expect(classifyDeliveryStatus("WRONG_ADDRESS")).toBe("FAILED");
    expect(classifyDeliveryStatus("ADDRESS_NOT_FOUND")).toBe("FAILED");
    expect(classifyDeliveryStatus("RECIPIENT_UNAVAILABLE")).toBe("FAILED");
    expect(classifyDeliveryStatus("FAILED")).toBe("FAILED");
  });

  it("classifies not-yet-attempted/in-flight statuses as REMAINING", () => {
    expect(classifyDeliveryStatus("RECEIVED")).toBe("REMAINING");
    expect(classifyDeliveryStatus("SORTED")).toBe("REMAINING");
    expect(classifyDeliveryStatus("ASSIGNED")).toBe("REMAINING");
    expect(classifyDeliveryStatus("OUT_FOR_DELIVERY")).toBe("REMAINING");
    expect(classifyDeliveryStatus("RESCHEDULED")).toBe("REMAINING");
  });
});

describe("computeDeliveryStats — mathematical invariant total = completed + failed + remaining", () => {
  it("case 1: 89 deliveries, completed=2, failed=1, remaining=86", () => {
    const statuses = [
      ...repeat("DELIVERED", 2),
      ...repeat("FAILED", 1),
      ...repeat("ASSIGNED", 86)
    ];
    const stats = computeDeliveryStats(statuses);
    expect(stats).toEqual({ total: 89, completed: 2, failed: 1, remaining: 86 });
    expect(stats.completed + stats.failed + stats.remaining).toBe(stats.total);
  });

  it("case 2: 10 deliveries, completed=5, failed=2, remaining=3", () => {
    const statuses = [
      ...repeat("DELIVERED", 5),
      ...repeat("WRONG_ADDRESS", 2),
      ...repeat("OUT_FOR_DELIVERY", 3)
    ];
    const stats = computeDeliveryStats(statuses);
    expect(stats).toEqual({ total: 10, completed: 5, failed: 2, remaining: 3 });
  });

  it("case 3: all completed", () => {
    const stats = computeDeliveryStats(repeat("DELIVERED", 10));
    expect(stats).toEqual({ total: 10, completed: 10, failed: 0, remaining: 0 });
  });

  it("case 4: all failed", () => {
    const stats = computeDeliveryStats(repeat("FAILED", 10));
    expect(stats).toEqual({ total: 10, completed: 0, failed: 10, remaining: 0 });
  });

  it("case 5: zero deliveries", () => {
    const stats = computeDeliveryStats([]);
    expect(stats).toEqual({ total: 0, completed: 0, failed: 0, remaining: 0 });
  });

  it("case 6: mixed terminal statuses (RETURNED/CANCELLED) count as failed, not remaining", () => {
    const statuses: DeliveryStatus[] = [
      "DELIVERED",
      "DELIVERED",
      "RETURNED",
      "CANCELLED",
      "REJECTED",
      "ASSIGNED",
      "RESCHEDULED"
    ];
    const stats = computeDeliveryStats(statuses);
    // completed: 2 DELIVERED
    // failed: RETURNED + CANCELLED + REJECTED = 3
    // remaining: ASSIGNED + RESCHEDULED = 2
    expect(stats).toEqual({ total: 7, completed: 2, failed: 3, remaining: 2 });
  });

  it("case 7: a remaining delivery moving to completed increments completed and decrements remaining, total unchanged", () => {
    const before = computeDeliveryStats([...repeat("DELIVERED", 2), ...repeat("ASSIGNED", 86), "FAILED"]);
    expect(before).toEqual({ total: 89, completed: 2, failed: 1, remaining: 86 });

    // Simulate one ASSIGNED -> DELIVERED transition.
    const after = computeDeliveryStats([...repeat("DELIVERED", 3), ...repeat("ASSIGNED", 85), "FAILED"]);
    expect(after).toEqual({ total: 89, completed: 3, failed: 1, remaining: 85 });
    expect(after.completed).toBe(before.completed + 1);
    expect(after.remaining).toBe(before.remaining - 1);
    expect(after.total).toBe(before.total);
  });

  it("case 8: a remaining delivery moving to failed increments failed and decrements remaining, total unchanged", () => {
    const before = computeDeliveryStats([...repeat("DELIVERED", 3), ...repeat("ASSIGNED", 85), "FAILED"]);
    expect(before).toEqual({ total: 89, completed: 3, failed: 1, remaining: 85 });

    // Simulate one ASSIGNED -> FAILED transition.
    const after = computeDeliveryStats([...repeat("DELIVERED", 3), ...repeat("ASSIGNED", 84), "FAILED", "FAILED"]);
    expect(after).toEqual({ total: 89, completed: 3, failed: 2, remaining: 84 });
    expect(after.failed).toBe(before.failed + 1);
    expect(after.remaining).toBe(before.remaining - 1);
    expect(after.total).toBe(before.total);
  });

  it("always satisfies the invariant for an arbitrary mix of every status", () => {
    const stats = computeDeliveryStats(ALL_STATUSES);
    expect(stats.completed + stats.failed + stats.remaining).toBe(stats.total);
    expect(stats.total).toBe(ALL_STATUSES.length);
  });
});
