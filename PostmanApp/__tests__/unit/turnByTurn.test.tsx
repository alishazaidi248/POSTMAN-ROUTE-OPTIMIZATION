import { act, renderHook, waitFor } from "@testing-library/react-native";
import { navigationApi } from "../../src/api/navigationApi";
import { useTurnByTurn } from "../../src/hooks/useTurnByTurn";
import { setLastFix } from "../../src/services/lastFix";
import { Directions } from "../../src/types/navigation";
import { LocationFix, LocationPermissionState } from "../../src/types/location";

jest.mock("../../src/api/navigationApi", () => ({ navigationApi: { getDirections: jest.fn() } }));

const getDirections = navigationApi.getDirections as jest.Mock;

// 400 m due north, then the delivery.
const LAT0 = 19.144;
const LNG0 = 72.93;
const north = (m: number) => LAT0 + m / 110_540;
const fixAt = (n: number, eastDeg = 0): LocationFix => ({ latitude: north(n), longitude: LNG0 + eastDeg, accuracy: 8, timestamp: Date.now() });

function straightNorth(mode: "BIKE" | "FOOT" = "BIKE"): Directions {
  const a: [number, number] = [LNG0, LAT0];
  const b: [number, number] = [LNG0, north(400)];
  return {
    mode,
    source: "ROAD",
    provider: "osrm",
    from: { latitude: LAT0, longitude: LNG0 },
    to: { latitude: b[1], longitude: b[0] },
    distanceMeters: 400,
    durationSeconds: 120,
    geometry: { type: "LineString", coordinates: [a, b] },
    steps: [
      { instruction: "Head north", maneuverType: "depart", modifier: null, exit: null, streetName: "", distanceMeters: 400, durationSeconds: 120, location: a, geometry: [a, b] },
      { instruction: "You have arrived", maneuverType: "arrive", modifier: null, exit: null, streetName: "", distanceMeters: 0, durationSeconds: 0, location: b, geometry: [b, b] }
    ],
    warnings: []
  };
}

type Props = { fix: LocationFix | null; permission: LocationPermissionState };
const render = (initial: Props) =>
  renderHook(({ fix, permission }: Props) => useTurnByTurn("d1", fix, permission), { initialProps: initial });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  getDirections.mockImplementation(async (_id: string, mode: "BIKE" | "FOOT") => straightNorth(mode));
});

it("asks for directions from the first GPS fix", async () => {
  const { result } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  expect(getDirections).toHaveBeenCalledWith("d1", "BIKE", { latitude: LAT0, longitude: LNG0 });
});

it("without a fix, waits briefly and then asks anyway (the server starts from the last known location)", async () => {
  jest.useFakeTimers();
  const { result } = render({ fix: null, permission: "GRANTED" });
  expect(getDirections).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(4_100);
  });
  expect(getDirections).toHaveBeenCalledWith("d1", "BIKE", null);
  jest.useRealTimers();
  await waitFor(() => expect(result.current.phase).toBe("READY"));
});

it("directions fetched before GPS answered are fetched again from the first fix", async () => {
  jest.useFakeTimers();
  const { result, rerender } = render({ fix: null, permission: "GRANTED" });
  await act(async () => {
    jest.advanceTimersByTime(4_100);
  });
  jest.useRealTimers();
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  expect(getDirections).toHaveBeenLastCalledWith("d1", "BIKE", null);

  rerender({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(getDirections).toHaveBeenCalledTimes(2));
  expect(getDirections).toHaveBeenLastCalledWith("d1", "BIKE", { latitude: LAT0, longitude: LNG0 });

  rerender({ fix: fixAt(10), permission: "GRANTED" });
  await waitFor(() => expect(result.current.progress).not.toBeNull());
  expect(getDirections).toHaveBeenCalledTimes(2);
});

it("starts at once from a fix another screen got moments ago, instead of waiting for GPS", async () => {
  setLastFix({ latitude: 19.15, longitude: 72.94, accuracy: 10, timestamp: Date.now() - 20_000 });
  const { result } = render({ fix: null, permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  expect(getDirections).toHaveBeenCalledWith("d1", "BIKE", { latitude: 19.15, longitude: 72.94 });
  setLastFix(null);
});

it("does not trust a fix from minutes ago", async () => {
  jest.useFakeTimers();
  setLastFix({ latitude: 19.15, longitude: 72.94, accuracy: 10, timestamp: Date.now() - 5 * 60_000 });
  render({ fix: null, permission: "GRANTED" });
  expect(getDirections).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(4_100);
  });
  expect(getDirections).toHaveBeenCalledWith("d1", "BIKE", null);
  setLastFix(null);
  jest.useRealTimers();
});

it("asks straight away when location is off", async () => {
  render({ fix: null, permission: "DENIED" });
  await waitFor(() => expect(getDirections).toHaveBeenCalledWith("d1", "BIKE", null));
});

it("counts down as the postman moves, and says when they have arrived", async () => {
  const { result, rerender } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));

  rerender({ fix: fixAt(100), permission: "GRANTED" });
  await waitFor(() => expect(result.current.progress?.remainingMeters).toBeCloseTo(300, 0));
  expect(result.current.arrived).toBe(false);

  rerender({ fix: fixAt(390), permission: "GRANTED" });
  await waitFor(() => expect(result.current.arrived).toBe(true));
});

it("reroutes only after several off-route fixes in a row, never on one stray fix", async () => {
  const now = jest.spyOn(Date, "now");
  let clock = 1_000_000;
  now.mockImplementation(() => clock);

  const { result, rerender } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  expect(getDirections).toHaveBeenCalledTimes(1);
  clock += 20_000; // past the minimum time between reroutes

  const away = 0.001; // ~105 m east of the line
  rerender({ fix: fixAt(100, away), permission: "GRANTED" });
  rerender({ fix: fixAt(110), permission: "GRANTED" }); // back on the line: the stray fix is forgotten
  rerender({ fix: fixAt(120, away), permission: "GRANTED" });
  rerender({ fix: fixAt(125, away), permission: "GRANTED" });
  expect(getDirections).toHaveBeenCalledTimes(1);

  rerender({ fix: fixAt(130, away), permission: "GRANTED" }); // third in a row
  await waitFor(() => expect(getDirections).toHaveBeenCalledTimes(2));
  expect(getDirections.mock.calls[1][2]).toEqual({ latitude: north(130), longitude: LNG0 + away });
  now.mockRestore();
});

it("does not reroute again within 15 seconds of the last request", async () => {
  const now = jest.spyOn(Date, "now");
  const clock = 2_000_000;
  now.mockImplementation(() => clock);

  const { result, rerender } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  for (const n of [100, 110, 120, 130]) rerender({ fix: fixAt(n, 0.001), permission: "GRANTED" });
  expect(getDirections).toHaveBeenCalledTimes(1);
  now.mockRestore();
});

it("keeps the directions on screen when a reroute fails", async () => {
  const now = jest.spyOn(Date, "now");
  let clock = 3_000_000;
  now.mockImplementation(() => clock);

  const { result, rerender } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));
  getDirections.mockRejectedValueOnce(new Error("Network unavailable."));
  clock += 20_000;
  for (const n of [100, 110, 120]) rerender({ fix: fixAt(n, 0.001), permission: "GRANTED" });

  await waitFor(() => expect(getDirections).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.rerouting).toBe(false));
  expect(result.current.phase).toBe("READY");
  expect(result.current.error).toBeNull();
  now.mockRestore();
});

it("shows the error when the first request fails, and can retry", async () => {
  getDirections.mockRejectedValueOnce(new Error("This address is not on the map yet."));
  const { result } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("ERROR"));
  expect(result.current.error).toBe("This address is not on the map yet.");

  act(() => result.current.retry());
  await waitFor(() => expect(result.current.phase).toBe("READY"));
});

it("switching to Walk fetches walking directions, and the choice is remembered for the next delivery", async () => {
  const { result, unmount } = render({ fix: fixAt(0), permission: "GRANTED" });
  await waitFor(() => expect(result.current.phase).toBe("READY"));

  act(() => result.current.setMode("FOOT"));
  await waitFor(() => expect(getDirections).toHaveBeenLastCalledWith("d1", "FOOT", expect.anything()));
  await waitFor(() => expect(result.current.directions?.mode).toBe("FOOT"));
  unmount();

  const next = render({ fix: fixAt(0), permission: "GRANTED" });
  expect(next.result.current.mode).toBe("FOOT");
  act(() => next.result.current.setMode("BIKE"));
});
