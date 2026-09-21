import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  deliveryImport: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  deliveryImportRow: { findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  delivery: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
const geocoder = vi.hoisted(() => ({ geocode: vi.fn() }));
const assign = vi.hoisted(() => ({ assignDeliveryToBeat: vi.fn() }));
const records = vi.hoisted(() => ({ createDeliveryRecords: vi.fn() }));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../src/services/geocoding", () => ({ getGeocodingService: () => geocoder }));
vi.mock("../src/services/assignment.service", () => assign);
vi.mock("../src/services/delivery.service", () => records);

import { cancelImport, confirmImport, remapImport } from "../src/services/imports/import.service";

const row = (n: number, trackingId: string) => ({
  id: `row${n}`,
  rowNumber: n,
  status: "VALID",
  normalizedData: {
    recipientName: `R${n}`, phone: "9820000000", addressLine1: `${n} Road`, city: "Mumbai", state: "MH", pincode: "400078", trackingId, priority: "high"
  }
});

const importRecord = { id: "imp1", postOfficeId: "poA", status: "PROCESSING", successfulRows: 0, geocodingFailedRows: 0, assignmentFailedRows: 0 };
const ok = { status: "SUCCESS", latitude: 19.15, longitude: 72.95, confidence: 1, source: "test" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.deliveryImport.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue(importRecord);
  prismaMock.deliveryImport.update.mockImplementation(async ({ data }: any) => ({ ...importRecord, ...data }));
  prismaMock.deliveryImportRow.update.mockResolvedValue({});
  prismaMock.deliveryImportRow.groupBy.mockResolvedValue([]);
  prismaMock.delivery.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn({ deliveryImportRow: { update: vi.fn() } }));
  geocoder.geocode.mockResolvedValue(ok);
  assign.assignDeliveryToBeat.mockResolvedValue({ status: "ASSIGNED", beatId: "b", postmanId: "p" });
  records.createDeliveryRecords.mockImplementation(async (_tx: unknown, input: any) => ({ deliveryId: `del-${input.trackingId}`, addressId: "a" }));
});

describe("confirmImport — everything is written to PostgreSQL, row by row", () => {
  it("saves every VALID row, assigns each, and marks the import CONFIRMED", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1"), row(2, "T2")]);

    const result = await confirmImport("imp1", "admin-1");

    expect(records.createDeliveryRecords).toHaveBeenCalledTimes(2);
    expect(assign.assignDeliveryToBeat).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "CONFIRMED", successfulRows: 2 });
    // priority text from the file is normalised, not stored raw
    expect(records.createDeliveryRecords.mock.calls[0][1].priority).toBe("HIGH");
  });

  it("two simultaneous confirms cannot both run: the second is refused before touching any row", async () => {
    prismaMock.deliveryImport.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue({ ...importRecord, status: "PROCESSING" });

    await expect(confirmImport("imp1", "admin-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(prismaMock.deliveryImportRow.findMany).not.toHaveBeenCalled();
  });

  it("a tracking id that appeared since the preview marks THAT row DUPLICATE and carries on with the rest", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1"), row(2, "T2")]);
    prismaMock.delivery.findUnique.mockImplementation(async ({ where }: any) => (where.trackingId === "T1" ? { id: "existing" } : null));

    const result = await confirmImport("imp1", "admin-1");

    expect(records.createDeliveryRecords).toHaveBeenCalledTimes(1);
    expect(records.createDeliveryRecords.mock.calls[0][1].trackingId).toBe("T2");
    expect(prismaMock.deliveryImportRow.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "row1" }, data: expect.objectContaining({ status: "DUPLICATE" }) }));
    expect(result.status).toBe("CONFIRMED"); // not wedged
  });

  it("a row the database rejects is marked INVALID with the reason; it does not abort the import", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1"), row(2, "T2")]);
    let n = 0;
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (++n === 1) throw new Error("boom: constraint violated");
      return fn({ deliveryImportRow: { update: vi.fn() } });
    });

    const result = await confirmImport("imp1", "admin-1");

    expect(prismaMock.deliveryImportRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row1" }, data: expect.objectContaining({ status: "INVALID" }) })
    );
    expect(result).toMatchObject({ status: "CONFIRMED", successfulRows: 1 });
    expect(result.errorSummary).toMatch(/1 row/);
  });

  it("a geocoding failure still SAVES the delivery (with a GEOCODING_FAILED exception) and skips beat matching", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1")]);
    geocoder.geocode.mockResolvedValue({ status: "FAILED", latitude: 0, longitude: 0, confidence: 0, source: "nominatim" });

    const result = await confirmImport("imp1", "admin-1");

    expect(records.createDeliveryRecords).toHaveBeenCalledTimes(1);
    expect(records.createDeliveryRecords.mock.calls[0][2].status).toBe("FAILED");
    expect(assign.assignDeliveryToBeat).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successfulRows: 1, geocodingFailedRows: 1 });
  });

  it("a geocoder that THROWS is treated as a failed geocode, not a crashed import", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1")]);
    geocoder.geocode.mockRejectedValue(new Error("network"));
    const result = await confirmImport("imp1", "admin-1");
    expect(result.status).toBe("CONFIRMED");
    expect(records.createDeliveryRecords.mock.calls[0][2].status).toBe("FAILED");
  });

  it("if beat matching throws AFTER the delivery was saved, the delivery stays saved and the import still completes", async () => {
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([row(1, "T1")]);
    assign.assignDeliveryToBeat.mockRejectedValue(new Error("postgis hiccup"));

    const result = await confirmImport("imp1", "admin-1");

    expect(records.createDeliveryRecords).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "CONFIRMED", successfulRows: 1, assignmentFailedRows: 1 });
  });

  it("if the whole run fails, the import returns to PREVIEW_READY so it can be confirmed again (saved rows stay saved)", async () => {
    prismaMock.deliveryImportRow.findMany.mockRejectedValue(new Error("connection lost"));

    await expect(confirmImport("imp1", "admin-1")).rejects.toThrow("connection lost");

    expect(prismaMock.deliveryImport.updateMany).toHaveBeenLastCalledWith({
      where: { id: "imp1", status: "PROCESSING" },
      data: { status: "PREVIEW_READY" }
    });
  });
});

describe("cancelImport", () => {
  it("cannot cancel a CONFIRMED import (its deliveries already exist)", async () => {
    prismaMock.deliveryImport.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue({ ...importRecord, status: "CONFIRMED" });
    await expect(cancelImport("imp1", "admin-1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("cancels an import that is still awaiting review", async () => {
    prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue({ ...importRecord, status: "CANCELLED" });
    const r = await cancelImport("imp1", "admin-1");
    expect(prismaMock.deliveryImport.updateMany.mock.calls[0][0].where.status.in).toContain("PREVIEW_READY");
    expect(r.status).toBe("CANCELLED");
  });
});

describe("remapImport — a new column mapping re-validates the stored rows", () => {
  const stored = (id: string, raw: Record<string, string>) => ({ id, rowNumber: 1, rawData: raw, status: "INVALID" });
  const mapping = { recipientName: "who", phone: "tel", addressLine1: "addr", city: "town", state: "st", pincode: "pin", trackingId: "awb" };

  it("refuses once the import has been confirmed", async () => {
    prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue({ ...importRecord, status: "CONFIRMED" });
    await expect(remapImport("imp1", mapping)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("turns rows valid under the corrected mapping, recounts, and saves the mapping — atomically", async () => {
    prismaMock.deliveryImport.findUniqueOrThrow.mockResolvedValue({ ...importRecord, status: "PREVIEW_READY" });
    prismaMock.deliveryImportRow.findMany.mockResolvedValue([
      stored("r1", { who: "Asha", tel: "9820011122", addr: "1 Road", town: "Mumbai", st: "MH", pin: "400078", awb: "NEW1" }),
      stored("r2", { who: "", tel: "9820011123", addr: "2 Road", town: "Mumbai", st: "MH", pin: "400078", awb: "NEW2" })
    ]);
    prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => ({ id: "imp1", validRows: 1 })));

    await remapImport("imp1", mapping);

    const updateCalls = prismaMock.deliveryImportRow.update.mock.calls.map((c: any) => c[0]);
    expect(updateCalls.find((c: any) => c.where.id === "r1").data.status).toBe("VALID");
    expect(updateCalls.find((c: any) => c.where.id === "r2").data.status).toBe("MISSING_DATA");
    const importUpdate = prismaMock.deliveryImport.update.mock.calls[0][0];
    expect(importUpdate.data).toMatchObject({ columnMapping: mapping, validRows: 1, missingDataRows: 1, invalidRows: 0 });
    // rows + the import's counts/mapping go through ONE $transaction array
    expect((prismaMock.$transaction.mock.calls[0][0] as unknown[]).length).toBe(3);
  });
});
