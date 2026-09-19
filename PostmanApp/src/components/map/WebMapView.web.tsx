import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OptimizationStop } from "../../types/route";
import { DeliveryStatus } from "../../types/delivery";
import { colors } from "../../theme/colors";
import { markerColor } from "../../utils/mapMarkerColor";

interface Props {
  styleUrl: string;
  center: [number, number]; // [lng, lat]
  stops: OptimizationStop[];
  statusByDeliveryId: Record<string, { status: string; name: string }>;
  currentDeliveryId: string | null;
  onSelectDelivery: (deliveryId: string) => void;
  onStyleError: () => void;
}

/**
 * Web-only map renderer using maplibre-gl (the browser JS library) directly,
 * imperatively — there is no official React wrapper, and this app avoids
 * adding a third dependency (react-map-gl) just for this one screen. This is
 * a deliberately separate implementation from MapScreen.native.tsx's
 * @maplibre/maplibre-react-native usage (that package has no web support);
 * see docs/mobile-architecture.md.
 */
export function WebMapView({ styleUrl, center, stops, statusByDeliveryId, currentDeliveryId, onSelectDelivery, onStyleError }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center,
      zoom: 13
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", onStyleError);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Re-created only if the style URL changes; center/stops are applied
    // imperatively below without tearing down the map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = stops.map((stop) => {
      const status = (statusByDeliveryId[stop.deliveryId]?.status as DeliveryStatus) ?? "ASSIGNED";
      const isCurrent = stop.deliveryId === currentDeliveryId;
      const el = document.createElement("div");
      el.style.width = isCurrent ? "26px" : "18px";
      el.style.height = isCurrent ? "26px" : "18px";
      el.style.borderRadius = "50%";
      el.style.border = `${isCurrent ? 3 : 2}px solid #FFFFFF`;
      el.style.backgroundColor = markerColor(status, isCurrent);
      el.style.cursor = "pointer";
      el.title = `Stop ${stop.sequence} — ${status}`;
      el.addEventListener("click", () => onSelectDelivery(stop.deliveryId));

      return new maplibregl.Marker({ element: el }).setLngLat([stop.longitude, stop.latitude]).addTo(map);
    });

    const applyRouteLine = () => {
      const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sorted.map((s) => [s.longitude, s.latitude]) }
      };

      const existing = map.getSource("routeLine") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
        return;
      }
      if (sorted.length < 2) return;
      map.addSource("routeLine", { type: "geojson", data: geojson });
      map.addLayer({
        id: "routeLineLayer",
        type: "line",
        source: "routeLine",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": colors.mapCurrent, "line-width": 3, "line-dasharray": [1, 1.5] }
      });
    };

    if (map.isStyleLoaded()) {
      applyRouteLine();
    } else {
      map.once("load", applyRouteLine);
    }
  }, [stops, statusByDeliveryId, currentDeliveryId, onSelectDelivery]);

  // On web, react-native-web's View forwards `ref` to the underlying DOM
  // <div>, which is exactly the container element maplibre-gl needs.
  return <View ref={containerRef as unknown as React.Ref<View>} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 }
});
