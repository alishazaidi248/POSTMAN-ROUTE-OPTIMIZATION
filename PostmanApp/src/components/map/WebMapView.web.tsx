import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MarkerModel, RouteLine } from "../../utils/routeView";
import { colors } from "../../theme/colors";
import { stateColor } from "../../utils/mapMarkerColor";
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

export interface MapPoint {
  latitude: number;
  longitude: number;
}

interface Props {
  styleUrl: string;
  center: [number, number]; // [lng, lat], used until the first fit
  /** [[west, south], [east, north]] around every stop + the route start. */
  bounds: [[number, number], [number, number]] | null;
  /** Re-fit the camera only when this changes (a stop set/route change), not on every render or GPS tick. */
  fitKey: string;
  markers: MarkerModel[];
  /** The route to draw: road geometry (solid) or a straight guide (dashed). */
  routeLine: RouteLine | null;
  start: (MapPoint & { label: string }) | null;
  userFix: MapPoint | null;
  selectedDeliveryId: string | null;
  onSelectDelivery: (deliveryId: string) => void;
  onStyleError: () => void;
}

const ROUTE_SOURCE = "routeLine";
const ARROW_IMAGE = "route-arrow";

/** A small white arrowhead pointing east; symbol-placement "line" rotates it along the route. */
function createArrowImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#FFFFFF";
  ctx.strokeStyle = colors.mapCurrent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(26, 16);
  ctx.lineTo(8, 26);
  ctx.lineTo(13, 16);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
}

function markerElement(m: MarkerModel, onSelect: (id: string) => void): HTMLDivElement {
  const el = document.createElement("div");
  // NB: never style `transform` on a maplibre marker element — the library
  // positions it with one. Size is used for emphasis instead.
  const size = m.selected || m.state === "NEXT" ? 38 : 30;
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    background: stateColor(m.state),
    color: "#FFFFFF",
    border: m.selected ? "4px solid #111827" : "3px solid #FFFFFF",
    boxShadow: m.selected ? "0 0 0 3px rgba(17,24,39,0.25)" : "0 1px 4px rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: `700 ${size > 30 ? 16 : 14}px system-ui, sans-serif`,
    cursor: "pointer",
    opacity: m.state === "DONE" ? "0.85" : "1",
    zIndex: m.selected ? "4" : m.state === "NEXT" ? "3" : m.state === "PENDING" ? "2" : "1",
    boxSizing: "border-box"
  } as Partial<CSSStyleDeclaration>);
  el.textContent = m.label;
  el.title = m.title;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", m.title);
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect(m.deliveryId);
  });
  return el;
}

function pinElement(label: string, title: string, background: string, size: number, round: boolean): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: round ? "50%" : "8px",
    background,
    color: "#FFFFFF",
    border: "3px solid #FFFFFF",
    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "700 13px system-ui, sans-serif",
    boxSizing: "border-box",
    zIndex: "5"
  } as Partial<CSSStyleDeclaration>);
  el.textContent = label;
  el.title = title;
  el.setAttribute("aria-label", title);
  return el;
}

/**
 * Web-only map renderer using maplibre-gl (the browser JS library) directly,
 * imperatively — there is no official React wrapper, and this app avoids
 * adding a third dependency (react-map-gl) just for this one screen. This is
 * a deliberately separate implementation from MapScreen.native.tsx's
 * @maplibre/maplibre-react-native usage (that package has no web support);
 * see docs/mobile-architecture.md.
 *
 * Draws: numbered stop markers (✓ done, ✕ failed), the route line with
 * direction arrows (solid = road geometry, dashed = straight-line guide),
 * the route start, and the device's GPS position; focuses the selected stop.
 */
export function WebMapView({
  styleUrl,
  center,
  bounds,
  fitKey,
  markers,
  routeLine,
  start,
  userFix,
  selectedDeliveryId,
  onSelectDelivery,
  onStyleError
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<(() => void)[]>([]);
  const markerObjsRef = useRef<maplibregl.Marker[]>([]);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const markersDataRef = useRef<MarkerModel[]>(markers);

  // Kept current for the selection-focus effect below (declared later, so it
  // always sees the latest markers when both change in the same render).
  useEffect(() => {
    markersDataRef.current = markers;
  }, [markers]);

  /** Runs `fn` now if the style has finished loading, otherwise right after it does. */
  const whenReady = (fn: () => void) => {
    if (readyRef.current) fn();
    else pendingRef.current.push(fn);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    readyRef.current = false;
    pendingRef.current = [];

    const map = new maplibregl.Map({ container: containerRef.current, style: styleUrl, center, zoom: 13 });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // Route line: casing + road line + dashed guide + direction arrows.
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "routeCasing",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 8, "line-opacity": 0.9 }
      });
      map.addLayer({
        id: "routeRoad",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "source"], "ROAD"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": colors.mapCurrent, "line-width": 5 }
      });
      map.addLayer({
        id: "routeGuide",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["!=", ["get", "source"], "ROAD"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": colors.mapCurrent, "line-width": 3, "line-dasharray": [1, 1.5] }
      });
      if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, createArrowImage());
      map.addLayer({
        id: "routeArrows",
        type: "symbol",
        source: ROUTE_SOURCE,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "icon-image": ARROW_IMAGE,
          "icon-size": 0.55,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });

      readyRef.current = true;
      pendingRef.current.splice(0).forEach((fn) => fn());
    });

    // Only a failure to LOAD the style is fatal. Later errors (a missing tile
    // or glyph) must not tear down a working map and replace it with an
    // error screen.
    map.on("error", () => {
      if (!readyRef.current) onStyleError();
    });

    mapRef.current = map;

    return () => {
      markerObjsRef.current.forEach((m) => m.remove());
      markerObjsRef.current = [];
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // Re-created only if the style URL changes; everything else is applied
    // imperatively below without tearing the map down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // Fit the camera to the round — only when the stop set / route actually changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    whenReady(() => map.fitBounds(bounds, { padding: { top: 170, bottom: 50, left: 40, right: 40 }, duration: 0, maxZoom: 17 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Numbered stop markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = markers.map((m) =>
      new maplibregl.Marker({ element: markerElement(m, onSelectDelivery) })
        .setLngLat([m.longitude, m.latitude])
        .addTo(map)
    );
  }, [markers, onSelectDelivery]);

  // Route line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData(
        routeLine
          ? {
              type: "Feature",
              properties: { source: routeLine.source },
              geometry: { type: "LineString", coordinates: routeLine.coordinates }
            }
          : { type: "FeatureCollection", features: [] }
      );
    });
     
  }, [routeLine]);

  // Route start ("S").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    if (!start) return;
    startMarkerRef.current = new maplibregl.Marker({ element: pinElement("S", start.label, colors.mapSelf, 28, false) })
      .setLngLat([start.longitude, start.latitude])
      .addTo(map);
  }, [start?.latitude, start?.longitude, start?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  // "You are here" from the device GPS.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userFix) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({ element: pinElement("", "You are here", "#2563EB", 18, true) })
        .setLngLat([userFix.longitude, userFix.latitude])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userFix.longitude, userFix.latitude]);
    }
  }, [userFix?.latitude, userFix?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the selected delivery (from the Deliveries tab, the banner, or a marker tap).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedDeliveryId) return;
    const target = markersDataRef.current.find((m) => m.deliveryId === selectedDeliveryId);
    if (!target) return;
    whenReady(() =>
      map.easeTo({
        center: [target.longitude, target.latitude],
        zoom: Math.max(map.getZoom(), 15.5),
        duration: 500,
        padding: { top: 150, bottom: 0, left: 0, right: 0 }
      })
    );
     
  }, [selectedDeliveryId]);

  // On web, react-native-web's View forwards `ref` to the underlying DOM
  // <div>, which is exactly the container element maplibre-gl needs.
  return <View ref={containerRef as unknown as React.Ref<View>} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 }
});
