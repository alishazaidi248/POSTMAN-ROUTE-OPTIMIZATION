import { markerColor } from "../../src/utils/mapMarkerColor";
import { colors } from "../../src/theme/colors";

describe("markerColor — delivery markers are visually distinct by status (spec 'MARKERS')", () => {
  it("colors the current stop distinctly regardless of its status", () => {
    expect(markerColor("ASSIGNED", true)).toBe(colors.mapCurrent);
    expect(markerColor("DELIVERED", true)).toBe(colors.mapCurrent);
  });

  it("colors a completed (DELIVERED) stop green", () => {
    expect(markerColor("DELIVERED", false)).toBe(colors.mapCompleted);
  });

  it("colors failed-bucket statuses with the failure color", () => {
    for (const status of ["FAILED", "REJECTED", "WRONG_ADDRESS", "RETURNED", "CANCELLED"] as const) {
      expect(markerColor(status, false)).toBe(colors.mapFailed);
    }
  });

  it("colors an in-progress/pending stop with the pending color", () => {
    expect(markerColor("ASSIGNED", false)).toBe(colors.mapPending);
    expect(markerColor("OUT_FOR_DELIVERY", false)).toBe(colors.mapPending);
  });

  it("agrees with the canonical classification used by filters/stats — never colors a COMPLETED status as failed or vice versa", () => {
    expect(markerColor("DELIVERED", false)).not.toBe(colors.mapFailed);
    expect(markerColor("FAILED", false)).not.toBe(colors.mapCompleted);
  });
});
