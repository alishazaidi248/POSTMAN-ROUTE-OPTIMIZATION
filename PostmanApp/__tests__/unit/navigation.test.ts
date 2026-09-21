import { Linking, Platform } from "react-native";
import { buildNavigationUrl, buildWebNavigationUrl, openNavigation } from "../../src/utils/navigation";
import { makeDelivery } from "../_support/fixtures";

const address = makeDelivery("n").address;
const target = { latitude: 19.1498, longitude: 72.9268, address };

describe("buildNavigationUrl — destination comes from the delivery's real coordinates", () => {
  it("opens Apple Maps driving directions on iOS", () => {
    const url = buildNavigationUrl(target, "ios");
    expect(url).toBe("http://maps.apple.com/?daddr=19.1498%2C72.9268&dirflg=d");
  });

  it("opens the Google Maps navigation intent on Android", () => {
    expect(buildNavigationUrl(target, "android")).toBe("google.navigation:q=19.1498%2C72.9268&mode=d");
  });

  it("uses a Google Maps directions URL everywhere else (web, desktop)", () => {
    const expected = "https://www.google.com/maps/dir/?api=1&destination=19.1498%2C72.9268&travelmode=driving";
    expect(buildNavigationUrl(target, "web")).toBe(expected);
    expect(buildWebNavigationUrl(target)).toBe(expected);
  });

  it("falls back to the written address when the coordinates are missing or unusable", () => {
    const written = encodeURIComponent("n Station Road, Bhandup West, Mumbai, Maharashtra, 400078");
    for (const bad of [
      { latitude: null, longitude: null },
      { latitude: 0, longitude: 0 },
      { latitude: 95, longitude: 10 }
    ]) {
      const url = buildNavigationUrl({ ...bad, address }, "web");
      expect(url).toContain(`destination=${written}`);
      expect(url).not.toContain("19.1498");
    }
  });

  it("never hard-codes a location: different deliveries give different URLs", () => {
    const other = buildNavigationUrl({ ...target, latitude: 19.2, longitude: 73.0 }, "web");
    expect(other).toContain("19.2%2C73");
    expect(other).not.toBe(buildNavigationUrl(target, "web"));
  });
});

describe("openNavigation", () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
    jest.restoreAllMocks();
  });

  it("opens the native URL when it works", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

    await expect(openNavigation(target)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("google.navigation:q=19.1498%2C72.9268&mode=d");
  });

  it("falls back to the Google Maps web URL when the native URL cannot be opened", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const open = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValueOnce(new Error("no handler"))
      .mockResolvedValueOnce(undefined as never);

    await expect(openNavigation(target)).resolves.toBe(true);
    expect(open).toHaveBeenLastCalledWith(expect.stringContaining("https://www.google.com/maps/dir/"));
  });

  it("resolves false — never throws — when nothing can open it", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("nope"));
    await expect(openNavigation(target)).resolves.toBe(false);
  });
});
