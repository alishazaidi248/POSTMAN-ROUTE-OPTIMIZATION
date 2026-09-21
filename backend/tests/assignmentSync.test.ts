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
  overrideAssignment,
  syncBeatDeliveries
} from "../src/services/assignment.service";

type Delivery = { id: string; status: string; assignedPostmanId: string | null };

/** A tiny in-memory stand-in for the parts of a Prisma transaction the sync uses. */
function fakeDb(opts: { activePostmanId: string | null; deliveries: Delivery[] }) {
  const state = { deliveries: opts.deliveries.map((d) => ({ ...d })), history: [] as any[], exceptions: [] as any[], resolved: [] as any[] };
  const db: any = {
    postmanBeatAssignment: {
      findFirst: vi.fn(async () => (opts.activePostmanId ? { postmanId: opts.activePostmanId } : null))
    },
    delivery: {
      findMany: vi.fn(async () => state.deliveries.map((d) => ({ ...d }))),
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

describe("syncBeatDeliveries — a beat's parcels follow the beat's postman", () => {
  it("hands SORTED and other-postman parcels to the postman who now covers the beat", async () => {
    const { db, state } = fakeDb({
      activePostmanId: "sunita",
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
    expect(result).toMatchObject({ assigned: 3, released: 0, postmanId: "sunita" });
    // d3 needed no change, so no history row for it.
    expect(state.history.map((h) => h.deliveryId).sort()).toEqual(["d1", "d2", "d4"]);
    expect(state.history[0]).toMatchObject({ reason: "BEAT_POSTMAN_CHANGED", changedBy: "admin-1", beatId: "beat12" });
  });

  it("only ever looks at parcels the system may move: not out for delivery, finished, or hand-assigned", async () => {
    const { db } = fakeDb({ activePostmanId: "sunita", deliveries: [] });
    await syncBeatDeliveries(db, "beat12");
    const where = db.delivery.findMany.mock.calls[0][0].where;
    expect(where.beatId).toBe("beat12");
    expect(where.status.in).toEqual(["SORTED", "ASSIGNED", "RESCHEDULED"]); // never OUT_FOR_DELIVERY / DELIVERED / failed
    expect(where.assignmentHistory).toEqual({ none: { isOverride: true } }); // admin overrides stay put
  });

  it("with no active postman the parcels are released and an exception is opened for the admin", async () => {
    const { db, state } = fakeDb({
      activePostmanId: null,
      deliveries: [
        { id: "d1", status: "ASSIGNED", assignedPostmanId: "ramesh" },
        { id: "d2", status: "SORTED", assignedPostmanId: null } // already released: untouched
      ]
    });

    const result = await syncBeatDeliveries(db, "beat12");

    expect(state.deliveries[0]).toMatchObject({ assignedPostmanId: null, status: "SORTED" });
    expect(result).toMatchObject({ assigned: 0, released: 1, postmanId: null });
    expect(state.exceptions).toEqual([expect.objectContaining({ deliveryId: "d1", reason: "NO_POSTMAN_ASSIGNED" })]);
    expect(state.history[0]).toMatchObject({ reason: "BEAT_LEFT_WITHOUT_POSTMAN", postmanId: null });
  });

  it("does not pile up a second identical exception when run again", async () => {
    const { db, state } = fakeDb({ activePostmanId: null, deliveries: [{ id: "d1", status: "ASSIGNED", assignedPostmanId: "ramesh" }] });
    state.exceptions.push({ deliveryId: "d1", reason: "NO_POSTMAN_ASSIGNED" });
    await syncBeatDeliveries(db, "beat12");
    expect(state.exceptions).toHaveLength(1);
  });

  it("closes the 'no postman' exception once a postman covers the beat", async () => {
    const { db, state } = fakeDb({ activePostmanId: "sunita", deliveries: [{ id: "d1", status: "SORTED", assignedPostmanId: null }] });
    await syncBeatDeliveries(db, "beat12");
    expect(state.resolved.some((r) => r.where.reason.in.includes("NO_POSTMAN_ASSIGNED"))).toBe(true);
  });
});

describe("assignPostmanToBeatTx — Beat 12: Ramesh -> Sunita", () => {
  function fakeTx(over: { postman?: any; beat?: any; leaving?: any[]; displaced?: any[] } = {}) {
    const postman = over.postman ?? { id: "sunita", postOfficeId: "poA", status: "ACTIVE" };
    const beat = over.beat ?? { id: "beat12", postOfficeId: "poA", status: "ACTIVE" };
    const log: string[] = [];
    const tx: any = {
      postman: {
        findUniqueOrThrow: vi.fn(async () => postman),
        update: vi.fn(async ({ where, data }: any) => {
          log.push(`postman ${where.id} assignedBeatId=${data.assignedBeatId}`);
          return { ...postman, ...data };
        })
      },
      beat: { findUniqueOrThrow: vi.fn(async () => beat) },
      postmanBeatAssignment: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(over.leaving ?? []) // the postman's own current beat(s)
          .mockResolvedValueOnce(over.displaced ?? []), // who held the target beat
        updateMany: vi.fn(async ({ where }: any) => log.push(`deactivate ${JSON.stringify(where)}`)),
        create: vi.fn(async ({ data }: any) => log.push(`create ${data.postmanId}->${data.beatId}`)),
        findFirst: vi.fn(async () => ({ postmanId: "sunita" }))
      },
      delivery: { findMany: vi.fn(async () => []), update: vi.fn() },
      deliveryAssignmentHistory: { create: vi.fn() },
      assignmentException: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() }
    };
    return { tx, log };
  }

  it("moves the beat to the new postman, clears the displaced one, and syncs the beat's parcels — in the SAME transaction", async () => {
    const { tx, log } = fakeTx({ displaced: [{ postmanId: "ramesh" }] });

    await assignPostmanToBeatTx(tx, "sunita", "beat12", "admin-1");

    expect(log).toContain("create sunita->beat12");
    expect(log).toContain("postman ramesh assignedBeatId=null"); // the displaced postman's denormalised beat cleared
    expect(log).toContain("postman sunita assignedBeatId=beat12");
    // The parcel sync ran on the tx itself (not on a separate connection):
    expect(tx.delivery.findMany).toHaveBeenCalled();
    expect(tx.delivery.findMany.mock.calls[0][0].where.beatId).toBe("beat12");
  });

  it("also re-syncs the beat the postman LEFT, so parcels there are not left with someone who moved", async () => {
    const { tx } = fakeTx({ leaving: [{ beatId: "beat7" }] });
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
