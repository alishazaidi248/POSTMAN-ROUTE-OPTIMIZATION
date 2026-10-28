import {
  buildRouteModel,
  computeProgress,
  formatDistance,
  formatDuration,
  isOffRoute,
  maneuverArrow,
  offRouteThreshold
} from "../../src/utils/navigationProgress";
import { Directions, NavigationStep } from "../../src/types/navigation";

// A small L-shaped leg in Bhandup: 300 m north, turn right, 200 m east to the delivery.
const LAT0 = 19.144;
const LNG0 = 72.93;
const north = (m: number) => m / 110_540;
const east = (m: number) => m / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (n: number, e: number): [number, number] => [LNG0 + east(e), LAT0 + north(n)];
const fix = (n: number, e: number) => ({ latitude: LAT0 + north(n), longitude: LNG0 + east(e) });

function step(over: Partial<NavigationStep> & Pick<NavigationStep, "maneuverType" | "geometry">): NavigationStep {
  return { instruction: "", modifier: null, exit: null, streetName: "", distanceMeters: 0, durationSeconds: 0, location: over.geometry[0], ...over };
}

function directions(steps: NavigationStep[], durationSeconds: number): Directions {
  const last = steps[steps.length - 1].location;
  return {
    mode: "BIKE",
    source: "ROAD",
    provider: "osrm",
    from: { latitude: steps[0].location[1], longitude: steps[0].location[0] },
    to: { latitude: last[1], longitude: last[0] },
    distanceMeters: 0,
    durationSeconds,
    geometry: { type: "LineString", coordinates: steps.flatMap((s) => s.geometry) },
    steps,
    warnings: []
  };
}

const L_ROUTE = directions(
  [
    step({ maneuverType: "depart", instruction: "Head north", geometry: [at(0, 0), at(150, 0), at(300, 0)] }),
    step({ maneuverType: "turn", modifier: "right", instruction: "Turn right onto LBS Marg", geometry: [at(300, 0), at(300, 200)] }),
    step({ maneuverType: "arrive", instruction: "You have arrived", geometry: [at(300, 200), at(300, 200)] })
  ],
  200
);

describe("buildRouteModel", () => {
  it("measures the route and where each manoeuvre falls along it", () => {
    const m = buildRouteModel(L_ROUTE);
    expect(m.totalMeters).toBeCloseTo(500, 0);
    expect(m.stepStarts.map((s) => Math.round(s))).toEqual([0, 300, 500]);
    // Shared boundary points between steps are not duplicated.
    expect(m.line).toHaveLength(4);
  });
});

describe("computeProgress along a simulated ride", () => {
  const model = buildRouteModel(L_ROUTE);

  it("at the start: the right turn is 300 m ahead, 500 m to go", () => {
    const p = computeProgress(model, fix(0, 0));
    expect(p.currentStepIndex).toBe(0);
    expect(p.nextStepIndex).toBe(1);
    expect(p.distanceToNextManeuverMeters).toBeCloseTo(300, 0);
    expect(p.remainingMeters).toBeCloseTo(500, 0);
    expect(p.remainingSeconds).toBeCloseTo(200, 0);
    expect(p.arrived).toBe(false);
  });

  it("halfway up the first street with ordinary GPS wobble: counts down, and is still on route", () => {
    const p = computeProgress(model, fix(150, 8));
    expect(p.distanceToNextManeuverMeters).toBeCloseTo(150, 0);
    expect(p.offRouteMeters).toBeCloseTo(8, 0);
    expect(isOffRoute(p, 10)).toBe(false);
  });

  it("after the turn: the next manoeuvre is arriving", () => {
    const p = computeProgress(model, fix(300, 50));
    expect(p.currentStepIndex).toBe(1);
    expect(model.steps[p.nextStepIndex!].maneuverType).toBe("arrive");
    expect(p.distanceToNextManeuverMeters).toBeCloseTo(150, 0);
    expect(p.remainingSeconds).toBeCloseTo(60, 0);
  });

  it("arrives within 30 m of the delivery", () => {
    expect(computeProgress(model, fix(300, 160)).arrived).toBe(false);
    expect(computeProgress(model, fix(300, 175)).arrived).toBe(true);
    expect(computeProgress(model, fix(310, 200)).arrived).toBe(true);
  });

  it("60 m off the street is off route, unless the fix itself is that vague", () => {
    const p = computeProgress(model, fix(150, -60));
    expect(isOffRoute(p, 10)).toBe(true);
    expect(isOffRoute(p, 60)).toBe(false);
  });

  it("never calls the postman off route once they have arrived", () => {
    const p = computeProgress(model, fix(300, 200));
    expect(isOffRoute(p, 5)).toBe(false);
  });
});

describe("a route that comes back along the same lane", () => {
  // 300 m north, U-turn, 300 m back south: the 250 m point and the 350 m point are the same spot on the ground.
  const outAndBack = buildRouteModel(
    directions(
      [
        step({ maneuverType: "depart", geometry: [at(0, 0), at(300, 0)] }),
        step({ maneuverType: "turn", modifier: "uturn", geometry: [at(300, 0), at(0, 2)] }),
        step({ maneuverType: "arrive", geometry: [at(0, 2), at(0, 2)] })
      ],
      300
    )
  );

  it("on the way back, stays on the return stretch instead of jumping to the outbound one", () => {
    const comingBack = computeProgress(outAndBack, fix(260, 1), { alongMeters: 330 } as never);
    expect(comingBack.alongMeters).toBeGreaterThan(300);
    expect(comingBack.currentStepIndex).toBe(1);
  });

  it("on the way out, stays on the outbound stretch", () => {
    const goingOut = computeProgress(outAndBack, fix(250, 1), { alongMeters: 230 } as never);
    expect(goingOut.alongMeters).toBeLessThan(300);
    expect(goingOut.currentStepIndex).toBe(0);
  });
});

describe("following a moving postman", () => {
  const model = buildRouteModel(L_ROUTE);

  it("does not lag behind going round the bend", () => {
    let previous = null;
    for (const [n, e] of [[280, 0], [295, 0], [300, 8], [300, 20]]) previous = computeProgress(model, fix(n, e), previous);
    expect(previous!.alongMeters).toBeCloseTo(320, 0);
    expect(previous!.currentStepIndex).toBe(1);
  });

  it("a long GPS jump lands where the fix really is, even when an earlier stretch passes 100 m away", () => {
    // A U: 300 m north, 100 m east, 280 m back south - the end is 100 m from the first street.
    const u = buildRouteModel(
      directions(
        [
          step({ maneuverType: "depart", geometry: [at(0, 0), at(300, 0)] }),
          step({ maneuverType: "turn", modifier: "right", geometry: [at(300, 0), at(300, 100)] }),
          step({ maneuverType: "turn", modifier: "right", geometry: [at(300, 100), at(20, 100)] }),
          step({ maneuverType: "arrive", geometry: [at(20, 100), at(20, 100)] })
        ],
        300
      )
    );
    const start = computeProgress(u, fix(20, 0));
    const nearlyThere = computeProgress(u, fix(80, 100), start);
    expect(nearlyThere.alongMeters).toBeCloseTo(620, 0);
    expect(nearlyThere.currentStepIndex).toBe(2);
  });

  it("once arrived, the banner is at the end of the route - no turn left to make", () => {
    const start = computeProgress(model, fix(20, 0));
    const atDoor = computeProgress(model, fix(300, 195), start);
    expect(atDoor.arrived).toBe(true);
    expect(atDoor.remainingMeters).toBe(0);
    expect(model.steps[atDoor.nextStepIndex!].maneuverType).toBe("arrive");
    expect(atDoor.distanceToNextManeuverMeters).toBe(0);
  });

  it("catches up after a long GPS gap (phone locked for a minute)", () => {
    const before = computeProgress(model, fix(20, 0));
    const after = computeProgress(model, fix(300, 120), before);
    expect(after.alongMeters).toBeCloseTo(420, 0);
    expect(after.offRouteMeters).toBeLessThan(1);
  });
});

describe("display helpers", () => {
  it("rounds distances the way people read them", () => {
    expect([0, 7, 43, 120.4, 987, 1000, 1260].map(formatDistance)).toEqual(["0 m", "5 m", "45 m", "120 m", "990 m", "1.0 km", "1.3 km"]);
  });

  it("formats time left", () => {
    expect([30, 90, 420, 3900].map(formatDuration)).toEqual(["under a minute", "2 min", "7 min", "1 h 5 min"]);
  });

  it("gives a vague fix more room before calling it off route", () => {
    expect([null, 10, 40, 200].map(offRouteThreshold)).toEqual([35, 35, 60, 80]);
  });

  it("draws an arrow for each manoeuvre", () => {
    expect(maneuverArrow({ maneuverType: "turn", modifier: "left" })).toBe("↰");
    expect(maneuverArrow({ maneuverType: "turn", modifier: "slight right" })).toBe("↗");
    expect(maneuverArrow({ maneuverType: "roundabout", modifier: "right" })).toBe("⟳");
    expect(maneuverArrow({ maneuverType: "arrive", modifier: null })).toBe("◉");
  });
});
