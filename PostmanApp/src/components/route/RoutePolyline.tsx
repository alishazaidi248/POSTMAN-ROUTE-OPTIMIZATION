import React from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { colors } from "../../theme/colors";
import { OptimizationStop } from "../../types/route";

interface Props {
  stops: OptimizationStop[];
}

/**
 * Straight-line connector between stops in sequence order. This is a visual
 * aid only, not the road-network path — the backend's optimizer currently
 * returns stop coordinates without a road polyline (see architecture
 * report §5); once it returns one (OSRM-backed), swap `coordinates` below
 * for the decoded polyline geometry.
 */
export function RoutePolyline({ stops }: Props) {
  if (stops.length < 2) return null;

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const coordinates = sorted.map((s) => [s.longitude, s.latitude]);

  return (
    <GeoJSONSource
      id="routeLine"
      data={{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }}
    >
      <Layer
        id="routeLineLayer"
        type="line"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{ "line-color": colors.mapCurrent, "line-width": 3, "line-dasharray": [1, 1.5] }}
      />
    </GeoJSONSource>
  );
}
