import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  delivery: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  beat: { findUniqueOrThrow: vi.fn() },
  postman: { findUniqueOrThrow: vi.fn() },
  deliveryAssignmentHistory: { create: vi.fn() },
  assignmentException: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
  assignPostmanToBeatTx,
  divideBeatDeliveries,
  overrideAssignment,
  syncBeatDeliveries
} from "../src/services/assignment.service";

type Delivery = { id: string; status: string; assignedPostmanId: string | null; latitude?: number | null; longitude?: number | null };

/** A tiny in-memory stand-in for the parts of a Prisma transaction the sync uses. */
function fakeDb(opts: { activePostmanIds: string[]; deliveries: Delivery[]; beatCenter?: { centerLatitude: number; centerLongitude: number } }) {
  const state = { deliveries: opts.deliveries.map((d) => ({ ...d })), history: [] as any[], exceptions: [] as any[], resolved: [] as any[] };
  const db: any = {
    postmanBeatAssignment: {
      findMany: vi.fn(async () => opts.activePostmanIds.map((postmanId) => ({ postmanId })))
    },
    beat: {
      findUnique: vi.fn(async () => opts.beatCenter ?? { centerLatitude: null, centerLongitude: null })
    },
    delivery: {
      findMany: vi.fn(async () =>
        state.deliveries.map((d) => ({ ...d, address: { latitude: d.latitude ?? null, longitude: d.longitude ?? null } }))
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const d = state.deliveries.find((x) => x.id === where.id)!;
        Object.assign(d, data);
        return d;
      })
    },
    deliveryAssignmentHistory: { create: vi.fn(async ({ data }: any) => state.history.push(data)) },
    assignmentException: {
      findFirst: vi.fn(async ({ where }: any) => state.exceptions.find((e) => e.deliveryId === where.deliveryId && e.reason === where.reason) ?? null),
      create: vi.fn(async ({ data }: any) => state.exceptions.push(data)),
      update: vi.fn(async ({ data }: any) => data),
      updateMany: vi.fn(async (args: any) => state.resolved.push(args))
    }
  };
  return { db, state };
}

beforeEach(() => vi.clearAllMocks());

describe("syncBeatDeliveries — a beat's parcels follow the beat's postmen", () => {
  it("hands SORTED and other-postman parcels to the one postman who now covers the beat", async () => {
    const { db, state } = fakeDb({
      activePostmanIds: ["sunita"],
      deliveries: [
        { id: "d1", status: "SORTED", assignedPostmanId: null }, // waiting for someone
        { id: "d2", status: "ASSIGNED", assignedPostmanId: "ramesh" }, // Ramesh used to cover the beat
        { id: "d3", status: "ASSIGNED", assignedPostmanId: "sunita" }, // already right
        { id: "d4", status: "RESCHEDULED", assignedPostmanId: "ramesh" }
      ]
    });

    const result = await syncBeatDeliveries(db, "beat12", "admin-1");

    const by = Object.fromEntries(state.deliveries.map((d) => [d.id, d]));
    expect(by.d1).toMatchObject({ assignedPostmanId: "sunita", status: "ASSIGNED" });
    expect(by.d2).toMatchObject({ assignedPostmanId: "sunita", status: "ASSIGNED" });
    expect(by.d3).toMatchObject({ assignedPostmanId: "sunita", status: "ASSIGNED" });
    expect(by.d4).toMatchObject({ assignedPostmanId: "sunita", status: "RESCHEDULED" }); // keeps its meaning
    expect(result).toMatchObject({ assigned: 3, released: 0, postmanIds: ["sunita"] });
    // d3 needed no change, so no history row for it.
    expect(state.history.map((h) => h.deliveryId).sort()).toEqual(["d1", "d2", "d4"]);
    expect(state.history[0]).toMatchObject({ reason: "BEAT_POSTMAN_CHANGED", changedBy: "admin-1", beatId: "beat12" });
  });

  it("splits the beat's parcels across all its active postmen, roughly evenly, when it has more than one", async () => {
    // Four deliveries spread east/west of the beat's centre: two postmen should each end up with 2.
    const { db, state } = fakeDb({
      activePostmanIds: ["ramesh", "sunita"],
      beatCenter: { centerLatitude: 19.0, centerLongitude: 72.0 },
      deliveries: [
        { id: "d-east-1", status: "SORTED", assignedPostmanId: null, latitude: 19.0, longitude: 72.01 },
        { id: "d-east-2", status: "SORTED", assignedPostmanId: null, latitude: 19.001, longitude: 72.01 },
        { id: "d-west-1", status: "SORTED", assignedPostmanId: null, latitude: 19.0, longitude: 71.99 },
        { id: "d-west-2", status: "SORTED", assignedPostmanId: null, latitude: 19.001, longitude: 71.99 }
      ]
    });

    const result = await syncBeatDeliveries(db, "beat12");

    expect(result.postmanIds.sort()).toEqual(["ramesh", "sunita"]);
    expect(result.assigned).toBe(4);
    const byPostman = new Map<string, number>();
    for (const d of state.deliveries) byPostman.set(d.assignedPostmanId, (byPostman.get(d.assignedPostmanId) ?? 0) + 1);
    // Balanced: each of the two postmen gets exactly half.
    expect([...byPostman.values()].sort()).toEqual([2, 2]);
    // Geographically sensible: the two "east" deliveries stay together, as do the two "west" ones.
    const postmanOf = (id: string) => state.deliveries.find((d) => d.id === id)!.assignedPostmanId;
    expect(postmanOf("d-east-1")).toBe(postmanOf("d-east-2"));
    expect(postmanOf("d-west-1")).toBe(postmanOf("d-west-2"));
    expect(postmanOf("d-east-1")).not.toBe(postmanOf("d-west-1"));
  });

  it("re-splits an odd count as evenly as possible (one postman gets the extra)", async () => {
    const { db, state } = fakeDb({
      activePostmanIds: ["a", "b", "c"],
      deliveries: Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, status: "SORTED", assignedPostmanId: null, latitude: 19.0 + i * 0.001, longitude: 72.0 }))
    });
    await syncBeatDeliveries(db, "beat12");
    const counts = new Map<string, number>();
    for (const d of state.deliveries) counts.set(d.assignedPostmanId, (counts.get(d.assignedPostmanId) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 2, 3]);
  });

  it("only ever looks at parcels the system may move: not out for delivery, finished, or hand-assigned", async () => {
    const { db } = fakeDb({ activePostmanIds: ["sunita"], deliveries: [] });
    await syncBeatDeliveries(db, "beat12");
    const where = db.delivery.findMany.mock.calls[0][0].where;
    expect(where.beatId).toBe("beat12");
    expect(where.status.in).toEqual(["SORTED", "ASSIGNED", "RESCHEDULED"]); // never OUT_FOR_DELIVERY / DELIVERED / failed
    expect(where.assignmentHistory).toEqual({ none: { isOverride: true } }); // admin overrides stay put
  });

  it("with no active postman the parcels are released and an exception is opened for the admin", async () => {
    const { db, state } = fakeDb({
      activePostmanIds: [],
      deliveries: [
        { id: "d1", status: "ASSIGNED", assignedPostmanId: "ramesh" },
        { id: "d2", status: "SORTED", assignedPostmanId: null } // already released: untouched
      ]
    });

    const result = await syncBeatDeliveries(db, "beat12");

    expect(state.deliveries[0]).toMatchObject({ assignedPostmanId: null, status: "SORTED" });
    expect(result).toMatchObject({ assigned: 0, released: 1, postmanIds: [] });
    expect(state.exceptions).toEqual([expect.objectContaining({ deliveryId: "d1", reason: "NO_POSTMAN_ASSIGNED" })]);
    expect(state.history[0]).toMatchObject({ reason: "BEAT_LEFT_WITHOUT_POSTMAN", postmanId: null });
  });

  it("does not pile up a second identical exception when run again", async () => {
    const { db, state } = fakeDb({ activePostmanIds: [], deliveries: [{ id: "d1", status: "ASSIGNED", assignedPostmanId: "ramesh" }] });
    state.exceptions.push({ deliveryId: "d1", reason: "NO_POSTMAN_ASSIGNED" });
    await syncBeatDeliveries(db, "beat12");
    expect(state.exceptions).toHaveLength(1);
  });

  it("closes the 'no postman' exception once a postman covers the beat", async () => {
    const { db, state } = fakeDb({ activePostmanIds: ["sunita"], deliveries: [{ id: "d1", status: "SORTED", assignedPostmanId: null }] });
    await syncBeatDeliveries(db, "beat12");
    expect(state.resolved.some((r) => r.where.reason.in.includes("NO_POSTMAN_ASSIGNED"))).toBe(true);
  });
});

describe("divideBeatDeliveries — the pure partitioning function", () => {
  const d = (id: string, latitude: number | null, longitude: number | null) => ({ id, latitude, longitude });

  it("gives everything to the one postman when there is only one", () => {
    const plan = divideBeatDeliveries([d("a", 19, 72), d("b", 19, 72)], ["solo"]);
    expect(plan.get("solo")).toHaveLength(2);
  });

  it("gives nothing to anyone when there are no deliveries", () => {
    const plan = divideBeatDeliveries([], ["a", "b"]);
    expect(plan.get("a")).toEqual([]);
    expect(plan.get("b")).toEqual([]);
  });

  it("spreads deliveries with no usable coordinates round-robin, instead of dropping them", () => {
    const plan = divideBeatDeliveries([d("a", null, null), d("b", null, null), d("c", null, null)], ["p1", "p2"]);
    expect((plan.get("p1")?.length ?? 0) + (plan.get("p2")?.length ?? 0)).toBe(3);
  });

  it("is deterministic: the same input always cuts the same way", () => {
    const deliveries = Array.from({ length: 11 }, (_, i) => d(`d${i}`, 19 + Math.sin(i) * 0.01, 72 + Math.cos(i) * 0.01));
    const plan1 = divideBeatDeliveries(deliveries, ["x", "y", "z"]);
    const plan2 = divideBeatDeliveries(deliveries, ["x", "y", "z"]);
    expect([...plan1.entries()].map(([k, v]) => [k, v.map((x) => x.id)])).toEqual([...plan2.entries()].map(([k, v]) => [k, v.map((x) => x.id)]));
  });
});

describe("assignPostmanToBeatTx — Beat 12: joining, not displacing", () => {
  function fakeTx(over: { postman?: any; beat?: any; leaving?: any[]; rosterOf?: Record<string, string[]> } = {}) {
    const postman = over.postman ?? { id: "sunita", postOfficeId: "poA", status: "ACTIVE" };
    const beat = over.beat ?? { id: "beat12", postOfficeId: "poA", status: "ACTIVE" };
    const rosterOf = over.rosterOf ?? {};
    const log: string[] = [];
    const tx: any = {
      postman: {
        findUniqueOrThrow: vi.fn(async () => postman),
        update: vi.fn(async ({ where, data }: any) => {
          log.push(`postman ${where.id} assignedBeatId=${data.assignedBeatId}`);
          return { ...postman, ...data };
        })
      },
      beat: {
        findUniqueOrThrow: vi.fn(async () => beat),
        findUnique: vi.fn(async () => ({ centerLatitude: null, centerLongitude: null }))
      },
      postmanBeatAssignment: {
        // The real code tells these two lookups apart by shape: by postmanId ("what does this postman currently
        // cover, so they can leave it"), or by beatId ("who covers this beat now, for syncBeatDeliveries").
        findMany: vi.fn(async ({ where }: any) => {
          if (where.postmanId) return over.leaving ?? [];
          return (rosterOf[where.beatId] ?? []).map((postmanId: string) => ({ postmanId }));
        }),
        updateMany: vi.fn(async ({ where }: any) => log.push(`deactivate ${JSON.stringify(where)}`)),
        create: vi.fn(async ({ data }: any) => log.push(`create ${data.postmanId}->${data.beatId}`))
      },
      delivery: { findMany: vi.fn(async () => []), update: vi.fn() },
      deliveryAssignmentHistory: { create: vi.fn() },
      assignmentException: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() }
    };
    return { tx, log };
  }

  it("adds the postman to the beat and syncs its parcels — in the SAME transaction", async () => {
    const { tx, log } = fakeTx({ rosterOf: { beat12: ["ramesh", "sunita"] } });

    await assignPostmanToBeatTx(tx, "sunita", "beat12", "admin-1");

    expect(log).toContain("create sunita->beat12");
    expect(log).toContain("postman sunita assignedBeatId=beat12");
    // The parcel sync ran on the tx itself (not on a separate connection):
    expect(tx.delivery.findMany).toHaveBeenCalled();
    expect(tx.delivery.findMany.mock.calls[0][0].where.beatId).toBe("beat12");
  });

  it("never displaces anyone already covering the beat: it only deactivates the moving postman's OWN old assignment", async () => {
    const { tx, log } = fakeTx({ rosterOf: { beat12: ["ramesh", "sunita"] } });
    await assignPostmanToBeatTx(tx, "sunita", "beat12", "admin-1");

    const deactivateCalls = tx.postmanBeatAssignment.updateMany.mock.calls.map((c: any) => c[0].where);
    expect(deactivateCalls).toEqual([{ postmanId: "sunita", isActive: true }]);
    // Nothing ever clears ramesh's denormalised beat - ramesh was never touched.
    expect(log.some((l: string) => l.startsWith("postman ramesh"))).toBe(false);
  });

  it("also re-syncs the beat the postman LEFT, so parcels there are not left with someone who moved", async () => {
    const { tx } = fakeTx({ leaving: [{ beatId: "beat7" }], rosterOf: { beat7: [], beat12: ["sunita"] } });
    await assignPostmanToBeatTx(tx, "sunita", "beat12");
    const syncedBeats = tx.delivery.findMany.mock.calls.map((c: any) => c[0].where.beatId).sort();
    expect(syncedBeats).toEqual(["beat12", "beat7"]);
  });

  it("refuses to link a postman and a beat from different post offices", async () => {
    const { tx } = fakeTx({ beat: { id: "beat12", postOfficeId: "poB", status: "ACTIVE" } });
    await expect(assignPostmanToBeatTx(tx, "sunita", "beat12")).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.postmanBeatAssignment.create).not.toHaveBeenCalled();
  });

  it("refuses an inactive beat", async () => {
    const { tx } = fakeTx({ beat: { id: "beat12", postOfficeId: "poA", status: "INACTIVE" } });
    await expect(assignPostmanToBeatTx(tx, "sunita", "beat12")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("beatId null just clears the postman's beat", async () => {
    const { tx, log } = fakeTx({ leaving: [{ beatId: "beat7" }] });
    await assignPostmanToBeatTx(tx, "sunita", null);
    expect(log).toContain("postman sunita assignedBeatId=null");
    expect(tx.postmanBeatAssignment.create).not.toHaveBeenCalled();
  });
});

describe("overrideAssignment guards", () => {
  const delivery = (over: object = {}) => ({ id: "d1", status: "ASSIGNED", postOfficeId: "poA", assignedPostmanId: "ramesh", ...over });
  const args = { deliveryId: "d1", postmanId: "sunita", reason: "covering", userId: "admin-1" };

  it("will not reassign a delivery that is already finished", async () => {
    for (const status of ["DELIVERED", "RETURNED", "CANCELLED"]) {
      prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(delivery({ status }));
      await expect(overrideAssignment(args)).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("will not link the delivery to a postman or beat of another post office", async () => {
    prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(delivery());
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "sunita", postOfficeId: "poB", status: "ACTIVE" });
    await expect(overrideAssignment(args)).rejects.toMatchObject({ statusCode: 400 });

    prismaMock.beat.findUniqueOrThrow.mockResolvedValue({ id: "b", postOfficeId: "poB" });
    await expect(overrideAssignment({ ...args, beatId: "b", postmanId: undefined })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("only an ACTIVE postman can be given deliveries", async () => {
    prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(delivery());
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "sunita", postOfficeId: "poA", status: "ON_LEAVE" });
    await expect(overrideAssignment(args)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a parcel handed to a different postman goes back to ASSIGNED; a rescheduled one keeps its status", async () => {
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "sunita", postOfficeId: "poA", status: "ACTIVE" });
    const txDelivery = { update: vi.fn().mockResolvedValue({}) };
    prismaMock.$transaction.mockImplementation(async (fn: any) =>
      fn({ delivery: txDelivery, deliveryAssignmentHistory: { create: vi.fn() }, assignmentException: { updateMany: vi.fn() } })
    );

    prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(delivery({ status: "OUT_FOR_DELIVERY" }));
    await overrideAssignment(args);
    expect(txDelivery.update.mock.calls[0][0].data).toMatchObject({ assignedPostmanId: "sunita", status: "ASSIGNED" });

    txDelivery.update.mockClear();
    prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(delivery({ status: "RESCHEDULED" }));
    await overrideAssignment(args);
    expect(txDelivery.update.mock.calls[0][0].data.status).toBe("RESCHEDULED");
  });
});
