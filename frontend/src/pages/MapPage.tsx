import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
// @ts-ignore - no bundled ESM types entry point, @types/mapbox__mapbox-gl-draw covers the shape
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../lib/auth";
import { Modal } from "../components/Modal";
import { TerritoryForm, TerritoryFormValues } from "../components/TerritoryForm";
import styles from "../styles/components.module.css";

function polygonCenter(coordinates: number[][]): [number, number] {
  const total = coordinates.reduce(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0]
  );
  return [total[0] / coordinates.length, total[1] / coordinates.length];
}

// Distinct, legible colors for telling adjacent beat squares apart on the map.
const BEAT_COLORS = [
  "#c22030", "#0b5c8a", "#1f7a3d", "#9a6a00",
  "#6b3fa0", "#c2410c", "#0f766e", "#a21caf",
  "#4d5b23", "#b3261e"
];

/**
 * Colors each beat individually so adjacent squares are easy to tell apart —
 * unless the loaded beats span more than one post office (a Super Admin
 * viewing everything at once), in which case every beat belonging to the
 * same post office/admin instead shares one color, so that admin's whole
 * territory reads as a single grouped block rather than a scatter of
 * unrelated squares.
 */
function colorizeBeats(geojson: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const postOfficeIds = Array.from(
    new Set(geojson.features.map((f) => f.properties?.postOfficeId).filter(Boolean))
  );
  const groupByPostOffice = postOfficeIds.length > 1;

  return {
    ...geojson,
    features: geojson.features.map((feature, index) => {
      const colorIndex = groupByPostOffice
        ? postOfficeIds.indexOf(feature.properties?.postOfficeId)
        : index;
      return {
        ...feature,
        properties: { ...feature.properties, color: BEAT_COLORS[colorIndex % BEAT_COLORS.length] }
      };
    })
  };
}

export function MapPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [pendingPolygon, setPendingPolygon] = useState<GeoJSON.Polygon | null>(null);

  async function refreshBeats() {
    const beats = await apiClient.get("/maps/beats").then((r) => r.data);
    const source = mapRef.current?.getSource("beats") as maplibregl.GeoJSONSource | undefined;
    source?.setData(colorizeBeats(beats));
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // OpenFreeMap's "liberty" style: a full OSM-derived vector style with
      // actual streets, buildings, place labels and administrative borders —
      // free, no API key. The bare demo-tiles style used before only drew
      // country outlines, which is why the map looked empty/plain.
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [72.9345, 19.1436],
      zoom: 13
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", async () => {
      // MapboxDraw adds its own sources/layers on init, which requires the
      // style to already be loaded — adding it before "load" fires makes it
      // silently fail to render or respond to clicks, which is why drawing
      // didn't work previously.
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {}
      });
      drawRef.current = draw;
      // @ts-ignore - MapboxDraw implements the maplibre-gl IControl interface even though its types target mapbox-gl
      map.addControl(draw, "top-left");

      map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
        const feature = e.features[0];
        if (feature?.geometry.type === "Polygon") {
          setPendingPolygon(feature.geometry as GeoJSON.Polygon);
        }
      });

      map.on("draw.modechange", (e: { mode: string }) => {
        setDrawing(e.mode === "draw_polygon");
      });

      const [beats, deliveries, postmen, postOffices] = await Promise.all([
        apiClient.get("/maps/beats").then((r) => r.data),
        apiClient.get("/maps/deliveries").then((r) => r.data),
        apiClient.get("/maps/postmen").then((r) => r.data),
        apiClient.get("/maps/post-offices").then((r) => r.data)
      ]);

      map.addSource("beats", { type: "geojson", data: colorizeBeats(beats) });
      map.addLayer({ id: "beat-fill", type: "fill", source: "beats", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.25 } });
      map.addLayer({ id: "beat-outline", type: "line", source: "beats", paint: { "line-color": ["get", "color"], "line-width": 2 } });

      map.addSource("deliveries", {
        type: "geojson",
        data: deliveries,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 45
      });
      map.addLayer({
        id: "delivery-clusters",
        type: "circle",
        source: "deliveries",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#a01822",
          "circle-radius": ["step", ["get", "point_count"], 14, 25, 18, 100, 24],
          "circle-opacity": 0.85
        }
      });
      map.addLayer({
        id: "delivery-cluster-count",
        type: "symbol",
        source: "deliveries",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 11 },
        paint: { "text-color": "#fff" }
      });
      map.addLayer({
        id: "delivery-points",
        type: "circle",
        source: "deliveries",
        filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#0b5c8a", "circle-radius": 5, "circle-stroke-width": 1, "circle-stroke-color": "#fff" }
      });

      map.addSource("postmen", { type: "geojson", data: postmen });
      map.addLayer({
        id: "postmen-points",
        type: "circle",
        source: "postmen",
        paint: { "circle-color": "#1f7a3d", "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#fff" }
      });

      map.addSource("post-offices", { type: "geojson", data: postOffices });
      map.addLayer({
        id: "post-office-points",
        type: "circle",
        source: "post-offices",
        paint: { "circle-color": "#1c1c1e", "circle-radius": 9, "circle-stroke-width": 2, "circle-stroke-color": "#fff" }
      });

      ["delivery-points", "postmen-points", "post-office-points"].forEach((layer) => {
        map.on("click", layer, (e) => {
          const feature = e.features?.[0];
          if (feature) setSelected(feature.properties as Record<string, unknown>);
        });
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      });

      map.on("click", "beat-fill", (e) => {
        const feature = e.features?.[0];
        if (feature) setSelected(feature.properties as Record<string, unknown>);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // MapboxDraw finishes a polygon on native browser "dblclick", which fires
  // whenever two clicks land close together in time — including two
  // deliberate, separate points placed quickly. That made it look like
  // drawing "stopped after 2 points". While actively drawing we swallow the
  // native dblclick before maplibre turns it into a map "dblclick" event, so
  // every click just adds a point; finishing is done via Enter or by
  // clicking the first point again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawing) return;

    const container = map.getCanvasContainer();
    const blockDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    container.addEventListener("dblclick", blockDblClick, true);
    return () => container.removeEventListener("dblclick", blockDblClick, true);
  }, [drawing]);

  function toggleDrawing() {
    if (!drawRef.current) return;
    if (drawing) {
      drawRef.current.changeMode("simple_select");
      drawRef.current.deleteAll();
      setDrawing(false);
    } else {
      drawRef.current.changeMode("draw_polygon");
      setDrawing(true);
    }
  }

  async function handleCreateTerritory(values: TerritoryFormValues) {
    if (!pendingPolygon || !user?.postOfficeId) {
      throw new Error("Missing polygon or post office context");
    }
    const center = polygonCenter(pendingPolygon.coordinates[0]);

    const created = await apiClient
      .post("/beats", {
        postOfficeId: user.postOfficeId,
        beatNumber: values.beatNumber,
        name: values.name,
        centerLatitude: center[1],
        centerLongitude: center[0],
        boundary: pendingPolygon
      })
      .then((r) => r.data);

    if (values.postmanId) {
      await apiClient.post(`/beats/${created.id}/assign-postman`, { postmanId: values.postmanId });
    }

    drawRef.current?.deleteAll();
    setDrawing(false);
    setPendingPolygon(null);
    await refreshBeats();
    queryClient.invalidateQueries({ queryKey: ["beats"] });
    queryClient.invalidateQueries({ queryKey: ["postmen"] });
  }

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 130px)" }}>
      <div
        style={{
          flex: 1,
          position: "relative",
          borderRadius: 6,
          overflow: "hidden",
          border: "2px solid var(--color-red-700)",
          boxShadow: "var(--shadow-card)"
        }}
      >
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}>
          <button className={drawing ? styles.buttonDanger : styles.buttonPrimary} onClick={toggleDrawing}>
            {drawing ? "Cancel Drawing" : "Draw Territory"}
          </button>
          {drawing && (
            <p style={{ fontSize: 12, background: "#fff", padding: "4px 8px", borderRadius: 4, marginTop: 6, maxWidth: 240 }}>
              Click to place each boundary point — add as many as you need. Press <strong>Enter</strong>, or click the
              first point again, to finish. <strong>Escape</strong> cancels.
            </p>
          )}
        </div>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
      <div className={styles.card} style={{ width: 280, overflowY: "auto" }}>
        <h3 className={styles.sectionTitle}>Details</h3>
        {selected ? (
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(selected, null, 2)}</pre>
        ) : (
          <p style={{ fontSize: 13, color: "var(--color-ink-500)" }}>Click a beat, delivery, postman or post office to see details.</p>
        )}
      </div>

      {pendingPolygon && (
        <Modal title="New Territory" onClose={() => { setPendingPolygon(null); drawRef.current?.deleteAll(); setDrawing(false); }}>
          <TerritoryForm
            onSubmit={handleCreateTerritory}
            onCancel={() => { setPendingPolygon(null); drawRef.current?.deleteAll(); setDrawing(false); }}
          />
        </Modal>
      )}
    </div>
  );
}
