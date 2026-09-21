import React from "react";
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { colors } from "../../theme/colors";
import { RouteLine } from "../../utils/routeView";

interface Props {
  line: RouteLine;
}

/**
 * The route line. When the backend supplied road geometry it is drawn solid;
 * a straight-line guide (routing engine unavailable) is drawn dashed so it is
 * never mistaken for a road path. Stop numbers on the markers give the
 * direction/order.
 */
export function RoutePolyline({ line }: Props) {
  if (line.coordinates.length < 2) return null;

  const isRoad = line.source === "ROAD";

  return (
    <GeoJSONSource
      id="routeLine"
      data={{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.coordinates } }}
    >
      <Layer
        id="routeLineCasing"
        type="line"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={{ "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.9 }}
      />
      <Layer
        id="routeLineLayer"
        type="line"
        layout={{ "line-join": "round", "line-cap": "round" }}
        paint={
          isRoad
            ? { "line-color": colors.mapCurrent, "line-width": 5 }
            : { "line-color": colors.mapCurrent, "line-width": 3, "line-dasharray": [1, 1.5] }
        }
      />
    </GeoJSONSource>
  );
}
