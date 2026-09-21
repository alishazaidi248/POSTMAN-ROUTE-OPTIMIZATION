import { describe, expect, it } from "vitest";
import { suggestColumnMapping } from "../src/services/imports/columnMapping";
import { normalizeAndValidateRow } from "../src/services/imports/validation";

const base = { Name: "R", Phone: "9820000000", Address: "21 Farid Nagar", City: "Mumbai", State: "MH", Pincode: "400078" };
const mapping = { recipientName: "Name", phone: "Phone", addressLine1: "Address", city: "City", state: "State", pincode: "Pincode", weightKg: "Weight" };

describe("delivery weight in the import", () => {
  it("is recognised by its usual column names", () => {
    expect(suggestColumnMapping(["Name", "Weight (kg)"].map((c) => c)).weightKg).toBeNull(); // "weight_(kg)" is not a guess we make
    expect(suggestColumnMapping(["Name", "Weight_KG"]).weightKg).toBe("Weight_KG");
    expect(suggestColumnMapping(["Name", "weight"]).weightKg).toBe("weight");
  });

  it("reads kilograms, tolerating a comma decimal and a trailing kg", () => {
    expect(normalizeAndValidateRow({ ...base, Weight: "2,5" }, mapping).normalized.weightKg).toBe(2.5);
    expect(normalizeAndValidateRow({ ...base, Weight: "12 kg" }, mapping).normalized.weightKg).toBe(12);
  });

  it("leaves the weight empty when the file has none (it is never invented, and never taken from a parcel count)", () => {
    const r = normalizeAndValidateRow({ ...base, Weight: "" }, mapping);
    expect(r.status).toBe("VALID");
    expect(r.normalized.weightKg).toBeUndefined();
  });

  it("rejects a weight that is not a positive number of kilograms", () => {
    for (const bad of ["abc", "0", "-3", "5000"]) {
      const r = normalizeAndValidateRow({ ...base, Weight: bad }, mapping);
      expect(r.status, bad).toBe("INVALID");
      expect(r.errors.join(" ")).toMatch(/Invalid weight/);
    }
  });
});
