import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OptimizationStop } from "../../types/route";
import { DeliveryStatus } from "../../types/delivery";
import { colors } from "../../theme/colors";
import { markerColor } from "../../utils/mapMarkerColor";
import maplibreGlPackageJson from "maplibre-gl/package.json";

// maplibre-gl needs a real, separately-loadable worker script to parse
// vector tiles (.pbf) off the main thread — without one, vector sources
// (roads/buildings/labels; raster sources like hillshading are unaffected)
// silently never finish loading and never request a single tile, which is
// exactly what produced the "blank map with markers but no basemap" bug.
// Metro's web dev server has no concept of copying an arbitrary file out of
// node_modules as a static asset (unlike webpack, which maplibre-gl's own
// bundler integration assumes), so `/maplibre-gl-worker.mjs` 404s to
// Metro's SPA-fallback HTML instead of real JS. Pointing at the same
// version's file on a CDN sidesteps needing a custom Metro asset pipeline.
// jsdelivr/unpkg both mirror npm 1:1, so this only works when the URL's
// version matches the installed `maplibre-gl` version exactly — read from
// package.json rather than hand-copied so an `npm update` can't silently
// desync the two.
maplibregl.setWorkerUrl(`https://cdn.jsdelivr.net/npm/maplibre-gl@${maplibreGlPackageJson.version}/dist/maplibre-gl-worker.mjs`);

interface Props {
  styleUrl: string;
  center: [number, number]; // [lng, lat], used only when `bounds` is null
  /** [[west, south], [east, north]] — when present, the map fits to this
   * box (covering all stops + current location) instead of `center`/a fixed
   * zoom, so the initial view always shows the actual delivery area rather
   * than a hardcoded default location. */
  bounds: [[number, number], [number, number]] | null;
  stops: OptimizationStop[];
  /** False when `stops` are unordered delivery pins rather than an actual
   * optimized route — drawing a connecting line in that case would falsely
   * imply a planned route order. */
  showRouteLine: boolean;
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
export function WebMapView({
  styleUrl,
  center,
  bounds,
  stops,
  showRouteLine,
  statusByDeliveryId,
  currentDeliveryId,
  onSelectDelivery,
  onStyleError
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map(
      bounds
        ? { container: containerRef.current, style: styleUrl, bounds, fitBoundsOptions: { padding: 48 } }
        : { container: containerRef.current, style: styleUrl, center, zoom: 13 }
    );
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("error", onStyleError);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Re-created only if the style URL changes; center/bounds/stops are
    // applied imperatively below without tearing down the map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;

    const applyBounds = () => map.fitBounds(bounds, { padding: 48, duration: 0 });
    if (map.isStyleLoaded()) applyBounds();
    else map.once("load", applyBounds);
    // Deliberately excludes the initial mount — that's handled by the
    // Map constructor's own `bounds` option above; this only re-fits when
    // the bounds change afterward (e.g. GPS fix arrives, route updates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.[0][0], bounds?.[0][1], bounds?.[1][0], bounds?.[1][1]]);

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
      const existing = map.getSource("routeLine") as maplibregl.GeoJSONSource | undefined;

      if (!showRouteLine) {
        existing?.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: sorted.map((s) => [s.longitude, s.latitude]) }
      };

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
  }, [stops, showRouteLine, statusByDeliveryId, currentDeliveryId, onSelectDelivery]);

  // On web, react-native-web's View forwards `ref` to the underlying DOM
  // <div>, which is exactly the container element maplibre-gl needs.
  return <View ref={containerRef as unknown as React.Ref<View>} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 }
});
