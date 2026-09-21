import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { BeatRecord, VERIFICATION_COLOR, boundsOf, territoryState } from "./beatTypes";
import styles from "./beats.module.css";

export interface OtherFeature {
  kind: "delivery" | "postman" | "postOffice";
  properties: Record<string, unknown>;
}

export interface BeatMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fitAll: () => void;
  focusBeat: (beat: BeatRecord) => void;
  locate: () => void;
  /** Draw a brand-new polygon (a new beat, or the territory of a beat that has none). */
  startDrawing: () => void;
  /** Edit the corners of a beat's existing territory. */
  startEditing: (beat: BeatRecord) => void;
  getDrawnPolygon: () => GeoJSON.Polygon | null;
  stopDrawing: () => void;
}

interface Props {
  beats: BeatRecord[];
  selectedId: string | null;
  /** While editing a beat's territory its saved outline is hidden (the editable copy replaces it). */
  editingId: string | null;
  drawing: boolean;
  layers: { deliveries: boolean; postmen: boolean; offices: boolean };
  deliveries?: GeoJSON.FeatureCollection;
  postmen?: GeoJSON.FeatureCollection;
  offices?: GeoJSON.FeatureCollection;
  onSelectBeat: (id: string | null) => void;
  onSelectOther: (feature: OtherFeature | null) => void;
  onPolygonDrawn: (polygon: GeoJSON.Polygon) => void;
  onDrawingChanged: (drawing: boolean) => void;
  onNotice: (message: string) => void;
  onStyleError: () => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const STATUS_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "verification"],
  "VERIFIED", VERIFICATION_COLOR.VERIFIED,
  "NEEDS_REVIEW", VERIFICATION_COLOR.NEEDS_REVIEW,
  VERIFICATION_COLOR.PENDING_VERIFICATION
];
const OTHER_LAYERS: { id: string; kind: OtherFeature["kind"] }[] = [
  { id: "delivery-points", kind: "delivery" },
  { id: "postmen-points", kind: "postman" },
  { id: "post-office-points", kind: "postOffice" }
];

function beatCollection(beats: BeatRecord[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: beats
      .filter((b) => b.boundary)
      .map((b) => ({
        type: "Feature",
        geometry: b.boundary as GeoJSON.Polygon,
        properties: { id: b.id, beatNumber: b.beatNumber, verification: territoryState(b), overlapping: (b.overlaps?.length ?? 0) > 0 }
      }))
  };
}

/**
 * The map workspace. It draws what the parent hands it (beats come from the API) and reports
 * what the administrator does (selects a beat, draws a polygon). It keeps no business data.
 */
export const BeatMap = forwardRef<BeatMapHandle, Props>(function BeatMap(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const locateMarker = useRef<maplibregl.Marker | null>(null);

  const fitBeats = (beats: BeatRecord[]) => {
    const map = mapRef.current;
    const polygons = beats.filter((b) => b.boundary).map((b) => boundsOf(b.boundary as GeoJSON.Polygon));
    if (!map || polygons.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    polygons.forEach(([sw, ne]) => bounds.extend(sw).extend(ne));
    map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 });
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    fitAll: () => fitBeats(propsRef.current.beats),
    focusBeat: (beat) => {
      const map = mapRef.current;
      if (!map) return;
      // On narrower screens the details open over part of the map (a drawer, or a sheet on a phone):
      // leave that part free so the beat is not hidden behind it.
      const w = window.innerWidth;
      const padding = w <= 760 ? { top: 60, left: 40, right: 40, bottom: 330 } : w <= 1100 ? { top: 60, bottom: 60, left: 40, right: 390 } : 90;
      if (beat.boundary) map.fitBounds(boundsOf(beat.boundary), { padding, maxZoom: 17, duration: 600 });
      else if (beat.centerLatitude !== null && beat.centerLongitude !== null) map.flyTo({ center: [beat.centerLongitude, beat.centerLatitude], zoom: 15 });
    },
    locate: () => {
      if (!navigator.geolocation) return propsRef.current.onNotice("This browser cannot show your location.");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const map = mapRef.current;
          if (!map) return;
          const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          locateMarker.current?.remove();
          locateMarker.current = new maplibregl.Marker({ color: "#1d4ed8" }).setLngLat(at).addTo(map);
          map.flyTo({ center: at, zoom: 15 });
        },
        () => propsRef.current.onNotice("Your location could not be found. Please allow location access in the browser.")
      );
    },
    startDrawing: () => {
      const draw = drawRef.current;
      if (!draw) return;
      draw.deleteAll();
      draw.changeMode("draw_polygon");
      propsRef.current.onDrawingChanged(true);
    },
    startEditing: (beat) => {
      const draw = drawRef.current;
      if (!draw || !beat.boundary) return;
      draw.deleteAll();
      const [id] = draw.add({ type: "Feature", properties: {}, geometry: beat.boundary });
      draw.changeMode("direct_select", { featureId: String(id) });
      propsRef.current.onDrawingChanged(true);
    },
    getDrawnPolygon: () => {
      const feature = drawRef.current?.getAll().features.find((f) => f.geometry.type === "Polygon");
      return feature ? (feature.geometry as GeoJSON.Polygon) : null;
    },
    stopDrawing: () => {
      const draw = drawRef.current;
      if (!draw) return;
      draw.changeMode("simple_select");
      draw.deleteAll();
      propsRef.current.onDrawingChanged(false);
    }
  }));

  // ── create the map once ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [72.9345, 19.1436],
      zoom: 13,
      attributionControl: { compact: true }
    });
    mapRef.current = map;

    map.on("error", (e) => {
      // A tile that fails to load is not fatal; a style that fails to load is.
      if (!map.isStyleLoaded() && !readyRef.current && /style|401|404|Failed to fetch/i.test(String(e.error?.message ?? ""))) {
        propsRef.current.onStyleError();
      }
    });

    map.on("load", () => {
      const draw = new MapboxDraw({ displayControlsDefault: false });
      drawRef.current = draw;
      map.addControl(draw as unknown as maplibregl.IControl);
      map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
        const feature = e.features[0];
        if (feature?.geometry.type === "Polygon") propsRef.current.onPolygonDrawn(feature.geometry);
      });
      map.on("draw.modechange", (e: { mode: string }) => {
        propsRef.current.onDrawingChanged(e.mode === "draw_polygon" || e.mode === "direct_select");
      });

      map.addSource("beats", { type: "geojson", data: beatCollection(propsRef.current.beats) });
      map.addLayer({
        id: "beats-fill",
        type: "fill",
        source: "beats",
        paint: { "fill-color": STATUS_COLOR, "fill-opacity": 0.13 }
      });
      map.addLayer({
        id: "beats-line-solid",
        type: "line",
        source: "beats",
        filter: ["==", ["get", "verification"], "VERIFIED"],
        paint: { "line-color": STATUS_COLOR, "line-width": 1.5, "line-opacity": 0.85 }
      });
      map.addLayer({
        id: "beats-line-dashed",
        type: "line",
        source: "beats",
        filter: ["!=", ["get", "verification"], "VERIFIED"],
        paint: { "line-color": STATUS_COLOR, "line-width": 1.5, "line-opacity": 0.95, "line-dasharray": [2, 2] }
      });
      // Territories that overlap another beat get a heavier violet dashed outline on top: an address inside the overlap cannot be assigned automatically.
      map.addLayer({
        id: "beats-line-overlap",
        type: "line",
        source: "beats",
        filter: ["==", ["get", "overlapping"], true],
        paint: { "line-color": "#7c3aed", "line-width": 3, "line-opacity": 0.9, "line-dasharray": [1, 1.5] }
      });
      map.addLayer({
        id: "beats-selected",
        type: "line",
        source: "beats",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": STATUS_COLOR, "line-width": 4 }
      });
      map.addLayer({
        id: "beats-label",
        type: "symbol",
        source: "beats",
        minzoom: 11,
        layout: { "text-field": ["get", "beatNumber"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.6 }
      });

      map.addSource("deliveries", { type: "geojson", data: propsRef.current.deliveries ?? EMPTY, cluster: true, clusterMaxZoom: 15, clusterRadius: 45 });
      map.addLayer({
        id: "delivery-clusters",
        type: "circle",
        source: "deliveries",
        filter: ["has", "point_count"],
        paint: { "circle-color": "#64748b", "circle-radius": ["step", ["get", "point_count"], 13, 25, 17, 100, 22], "circle-opacity": 0.85 }
      });
      map.addLayer({
        id: "delivery-cluster-count",
        type: "symbol",
        source: "deliveries",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 11, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#fff" }
      });
      map.addLayer({
        id: "delivery-points",
        type: "circle",
        source: "deliveries",
        filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#475569", "circle-radius": 4.5, "circle-stroke-width": 1, "circle-stroke-color": "#fff" }
      });
      map.addSource("postmen", { type: "geojson", data: propsRef.current.postmen ?? EMPTY });
      map.addLayer({
        id: "postmen-points",
        type: "circle",
        source: "postmen",
        paint: { "circle-color": "#2563eb", "circle-radius": 6.5, "circle-stroke-width": 2, "circle-stroke-color": "#fff" }
      });
      map.addSource("post-offices", { type: "geojson", data: propsRef.current.offices ?? EMPTY });
      map.addLayer({
        id: "post-office-points",
        type: "circle",
        source: "post-offices",
        paint: { "circle-color": "#111827", "circle-radius": 8, "circle-stroke-width": 2, "circle-stroke-color": "#fff" }
      });

      map.on("click", (e) => {
        if (drawRef.current && drawRef.current.getMode() !== "simple_select") return; // drawing: clicks belong to the drawing
        const other = map.queryRenderedFeatures(e.point, { layers: OTHER_LAYERS.map((l) => l.id) })[0];
        if (other) {
          const kind = OTHER_LAYERS.find((l) => l.id === other.layer.id)?.kind ?? "delivery";
          propsRef.current.onSelectOther({ kind, properties: (other.properties ?? {}) as Record<string, unknown> });
          return;
        }
        const beat = map.queryRenderedFeatures(e.point, { layers: ["beats-fill"] })[0];
        if (beat) propsRef.current.onSelectBeat(String(beat.properties?.id));
        else propsRef.current.onSelectBeat(null);
      });
      for (const id of ["beats-fill", ...OTHER_LAYERS.map((l) => l.id)]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }

      readyRef.current = true;
      syncAll();
      if (propsRef.current.beats.some((b) => b.boundary)) fitBeats(propsRef.current.beats);
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);

    return () => {
      resize.disconnect();
      locateMarker.current?.remove();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      readyRef.current = false;
    };
    // the map is created once; later changes flow through syncAll below
  }, []);

  function syncAll() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = propsRef.current;
    (map.getSource("beats") as maplibregl.GeoJSONSource | undefined)?.setData(beatCollection(p.beats));
    (map.getSource("deliveries") as maplibregl.GeoJSONSource | undefined)?.setData(p.deliveries ?? EMPTY);
    (map.getSource("postmen") as maplibregl.GeoJSONSource | undefined)?.setData(p.postmen ?? EMPTY);
    (map.getSource("post-offices") as maplibregl.GeoJSONSource | undefined)?.setData(p.offices ?? EMPTY);

    const selected = p.selectedId ?? "";
    map.setFilter("beats-selected", ["==", ["get", "id"], selected]);
    map.setPaintProperty("beats-fill", "fill-opacity", ["case", ["==", ["get", "id"], selected], 0.24, 0.13]);

    // the beat being re-drawn is shown only as the editable copy
    const hide: maplibregl.FilterSpecification | null = p.editingId ? ["!=", ["get", "id"], p.editingId] : null;
    map.setFilter("beats-fill", hide);
    map.setFilter("beats-label", hide);
    map.setFilter("beats-line-solid", hide ? ["all", ["==", ["get", "verification"], "VERIFIED"], hide] : ["==", ["get", "verification"], "VERIFIED"]);
    map.setFilter("beats-line-dashed", hide ? ["all", ["!=", ["get", "verification"], "VERIFIED"], hide] : ["!=", ["get", "verification"], "VERIFIED"]);
    if (p.editingId) map.setFilter("beats-selected", ["==", ["get", "id"], ""]);

    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    ["delivery-clusters", "delivery-cluster-count", "delivery-points"].forEach((id) => vis(id, p.layers.deliveries));
    vis("postmen-points", p.layers.postmen);
    vis("post-office-points", p.layers.offices);
  }

  useEffect(syncAll, [props.beats, props.selectedId, props.editingId, props.layers, props.deliveries, props.postmen, props.offices]);

  // While drawing, a native double-click would finish the polygon early; every click adds a point instead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.drawing) return;
    const container = map.getCanvasContainer();
    const block = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    container.addEventListener("dblclick", block, true);
    return () => container.removeEventListener("dblclick", block, true);
  }, [props.drawing]);

  return <div ref={containerRef} className={styles.mapCanvas} data-testid="beat-map" />;
});

