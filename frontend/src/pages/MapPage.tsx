import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { friendlyError, overlapConflict } from "../lib/friendlyError";
import { Icon } from "../components/icons";
import { useToast } from "../components/Toast";
import { BeatMap, BeatMapHandle, OtherFeature } from "../features/beats/BeatMap";
import { BeatRecord, VERIFICATION_COLOR, VERIFICATION_LABEL } from "../features/beats/beatTypes";
import { BeatDetailsPanel, EmptyPanel, OtherFeaturePanel } from "../features/beats/BeatDetailsPanel";
import { BeatSearch, BeatSummary, BeatTable, Filter, matchesFilter } from "../features/beats/BeatBrowse";
import { AssignPostmanDialog, EditBeatDialog, NewBeatDialog, VerifyBeatDialog } from "../features/beats/BeatDialogs";
import { UploadBeatListWizard } from "../features/beats/UploadBeatListWizard";
import styles from "../features/beats/beats.module.css";

type Mode = { kind: "browse" } | { kind: "newBeat" } | { kind: "territory"; beatId: string };
type Dialog =
  | { kind: "verify" | "assign" | "edit"; beatId: string }
  | { kind: "newBeat"; polygon: GeoJSON.Polygon }
  | { kind: "upload" }
  | null;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const on = () => setMatches(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, [query]);
  return matches;
}

const geo = (path: string) => () => apiClient.get<GeoJSON.FeatureCollection>(path).then((r) => r.data);

export function MapPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const mapHandle = useRef<BeatMapHandle>(null);
  const isDesktop = useMediaQuery("(min-width: 1101px)");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [other, setOther] = useState<OtherFeature | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [layers, setLayers] = useState({ deliveries: true, postmen: true, offices: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [styleFailed, setStyleFailed] = useState(false);

  // Everything shown comes from the API (PostgreSQL); nothing about a beat is kept in the browser.
  const beatsQuery = useQuery<BeatRecord[]>({ queryKey: ["beats"], queryFn: () => apiClient.get("/beats").then((r) => r.data) });
  const deliveriesQuery = useQuery({ queryKey: ["map-deliveries"], queryFn: geo("/maps/deliveries") });
  const postmenQuery = useQuery({ queryKey: ["map-postmen"], queryFn: geo("/maps/postmen") });
  const officesQuery = useQuery({ queryKey: ["map-offices"], queryFn: geo("/maps/post-offices") });

  const beats = useMemo(() => beatsQuery.data ?? [], [beatsQuery.data]);
  const selected = beats.find((b) => b.id === selectedId) ?? null;
  const visibleBeats = useMemo(() => beats.filter((b) => matchesFilter(b, filter)), [beats, filter]);
  const needAttention = beats.filter((b) => b.verificationStatus !== "VERIFIED").length;
  const editingBeat = mode.kind === "territory" ? beats.find((b) => b.id === mode.beatId) ?? null : null;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["beats"] });
    void queryClient.invalidateQueries({ queryKey: ["map-deliveries"] });
  }, [queryClient]);

  const choose = useCallback((beat: BeatRecord, moveMap = true) => {
    setSelectedId(beat.id);
    setOther(null);
    if (moveMap) mapHandle.current?.focusBeat(beat);
  }, []);

  // /map?beat=<id> opens with that beat selected (used after an import and from other pages).
  useEffect(() => {
    const wanted = params.get("beat");
    if (!wanted || beats.length === 0) return;
    const beat = beats.find((b) => b.id === wanted);
    if (beat) window.setTimeout(() => choose(beat), 700);
    setParams({}, { replace: true });
  }, [params, beats, choose, setParams]);

  // Escape leaves drawing/editing.
  useEffect(() => {
    if (mode.kind === "browse") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelDrawing();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function cancelDrawing() {
    mapHandle.current?.stopDrawing();
    setMode({ kind: "browse" });
    setHasDrawn(false);
  }

  function startNewBeat() {
    setSelectedId(null);
    setOther(null);
    setMode({ kind: "newBeat" });
    setHasDrawn(false);
    mapHandle.current?.startDrawing();
  }

  function startTerritory(beat: BeatRecord) {
    setMode({ kind: "territory", beatId: beat.id });
    setHasDrawn(beat.hasTerritory);
    if (beat.hasTerritory) mapHandle.current?.startEditing(beat);
    else {
      mapHandle.current?.focusBeat(beat);
      mapHandle.current?.startDrawing();
    }
  }

  const saveTerritory = useMutation({
    mutationFn: async ({ beat, acknowledge }: { beat: BeatRecord; acknowledge?: boolean }) => {
      const polygon = mapHandle.current?.getDrawnPolygon();
      if (!polygon) throw new Error("no polygon");
      // A beat that was already verified stays verified: the administrator has just looked at the change.
      await apiClient.put(`/beats/${beat.id}`, { boundary: polygon, verified: beat.verificationStatus === "VERIFIED", acknowledgeOverlap: acknowledge || undefined });
    },
    onSuccess: () => {
      toast.success("Territory updated successfully.");
      cancelDrawing();
      refresh();
    },
    onError: (err, { beat }) => {
      const overlap = overlapConflict(err);
      // An overlap is a decision: ask, and save again only when the administrator says it is intended.
      if (overlap && window.confirm(`${overlap}\n\nSave this territory anyway?`)) {
        saveTerritory.mutate({ beat, acknowledge: true });
        return;
      }
      toast.error(overlap ?? friendlyError(err, "Territory could not be saved."));
    }
  });

  const onPolygonDrawn = (polygon: GeoJSON.Polygon) => {
    setHasDrawn(true);
    if (mode.kind === "newBeat") {
      setDialog({ kind: "newBeat", polygon });
    }
  };

  const dialogBeat = dialog && "beatId" in dialog ? beats.find((b) => b.id === dialog.beatId) ?? null : null;
  const closeDialog = () => setDialog(null);
  const dialogDone = () => {
    closeDialog();
    refresh();
  };

  const panelOpen = !!selected || !!other;
  const showPanelColumn = isDesktop || panelOpen;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Operations Map</h1>
          <p className={styles.pageSub}>Manage and verify delivery beats</p>
        </div>
        <div className={styles.toolbar}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setDialog({ kind: "upload" })} disabled={mode.kind !== "browse"}>
            <Icon name="upload" size={16} /> Upload Beat List
          </button>
          <button className={styles.btn} onClick={startNewBeat} disabled={mode.kind !== "browse"}>
            <Icon name="draw" size={16} /> Draw Beat
          </button>
          <BeatSearch beats={beats} onPick={(b) => choose(b)} />
        </div>
      </div>

      {beats.length > 0 && <BeatSummary beats={beats} filter={filter} onFilter={setFilter} />}

      <div className={`${styles.workspace} ${showPanelColumn ? "" : styles.workspaceNoPanel}`}>
        <div className={styles.mapFrame}>
          {styleFailed ? (
            <div className={styles.emptyPanel} style={{ margin: "auto", textAlign: "center", alignItems: "center", height: "100%", justifyContent: "center" }}>
              <strong>The map could not be loaded</strong>
              <span>Please check your internet connection.</span>
              <button className={styles.btn} onClick={() => { setStyleFailed(false); setMapKey((k) => k + 1); }}>Try Again</button>
            </div>
          ) : (
            <BeatMap
              key={mapKey}
              ref={mapHandle}
              beats={beats}
              selectedId={selectedId}
              editingId={mode.kind === "territory" && editingBeat?.hasTerritory ? mode.beatId : null}
              drawing={drawing}
              layers={layers}
              deliveries={deliveriesQuery.data}
              postmen={postmenQuery.data}
              offices={officesQuery.data}
              onSelectBeat={(id) => {
                setSelectedId(id);
                setOther(null);
              }}
              onSelectOther={(feature) => {
                setOther(feature);
                if (feature) setSelectedId(null);
              }}
              onPolygonDrawn={onPolygonDrawn}
              onDrawingChanged={setDrawing}
              onNotice={(m) => toast.info(m)}
              onStyleError={() => setStyleFailed(true)}
            />
          )}

          <div className={styles.legend} aria-label="Map key">
            {(["VERIFIED", "PENDING_VERIFICATION", "NEEDS_REVIEW"] as const).map((v) => (
              <span key={v} className={styles.legendItem}>
                <span className={styles.legendSwatch} style={{ borderColor: VERIFICATION_COLOR[v], background: `${VERIFICATION_COLOR[v]}33`, borderStyle: v === "VERIFIED" ? "solid" : "dashed" }} />
                {VERIFICATION_LABEL[v]}
              </span>
            ))}
          </div>

          <div className={styles.mapControls}>
            <div className={styles.mapControlGroup}>
              <button className={styles.mapControl} onClick={() => mapHandle.current?.zoomIn()} aria-label="Zoom in"><Icon name="plus" /></button>
              <button className={styles.mapControl} onClick={() => mapHandle.current?.zoomOut()} aria-label="Zoom out"><Icon name="minus" /></button>
            </div>
            <div className={styles.mapControlGroup}>
              <button className={styles.mapControl} onClick={() => mapHandle.current?.locate()} aria-label="Show my location" title="Show my location"><Icon name="locate" /></button>
              <button className={styles.mapControl} onClick={() => mapHandle.current?.fitAll()} aria-label="Fit all beats" title="Fit all beats"><Icon name="fit" /></button>
            </div>
          </div>

          <div className={styles.layersBox}>
            {layersOpen && (
              <div className={styles.layersPop}>
                {([["deliveries", "Deliveries"], ["postmen", "Postmen"], ["offices", "Post offices"]] as const).map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })} /> {label}
                  </label>
                ))}
              </div>
            )}
            <button className={styles.btn} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
              <Icon name="layers" size={16} /> Layers
            </button>
          </div>

          {mode.kind !== "browse" && (
            <div className={styles.editBar} role="status" data-testid="edit-bar">
              <div className={styles.editBarText}>
                {mode.kind === "newBeat" ? (
                  <>
                    <strong>Draw the new beat</strong>
                    <small>Click each corner on the map. Press Enter or click the first point to finish.</small>
                  </>
                ) : (
                  <>
                    <strong>{editingBeat?.hasTerritory ? "Editing" : "Drawing"} territory for beat {editingBeat?.beatNumber}</strong>
                    <small>{editingBeat?.hasTerritory ? "Drag the corners to change the outline." : "Click each corner, then press Enter or click the first point."}</small>
                  </>
                )}
              </div>
              {mode.kind === "territory" && editingBeat && (
                <button
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                  onClick={() => saveTerritory.mutate({ beat: editingBeat })}
                  disabled={!hasDrawn || saveTerritory.isPending}
                >
                  {saveTerritory.isPending ? "Saving..." : "Save Territory"}
                </button>
              )}
              <button className={`${styles.btn} ${styles.btnSmall}`} onClick={cancelDrawing}>Cancel</button>
            </div>
          )}
        </div>

        {showPanelColumn && (
          <div className={isDesktop ? undefined : styles.panelDrawer} style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            {selected ? (
              <BeatDetailsPanel
                beat={selected}
                onClose={() => setSelectedId(null)}
                onEditBeat={() => setDialog({ kind: "edit", beatId: selected.id })}
                onAssign={() => setDialog({ kind: "assign", beatId: selected.id })}
                onVerify={() => {
                  mapHandle.current?.focusBeat(selected);
                  setDialog({ kind: "verify", beatId: selected.id });
                }}
                onEditTerritory={() => startTerritory(selected)}
                onDrawTerritory={() => startTerritory(selected)}
              />
            ) : other ? (
              <OtherFeaturePanel feature={other} onClose={() => setOther(null)} />
            ) : (
              <EmptyPanel hasBeats={beats.length > 0} needAttention={needAttention} />
            )}
          </div>
        )}
      </div>

      {beatsQuery.isError ? (
        <div className={styles.tableCard}>
          <div className={styles.tableEmpty}>
            The beats could not be loaded. <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => void beatsQuery.refetch()}>Try Again</button>
          </div>
        </div>
      ) : (
        <BeatTable
          beats={visibleBeats}
          selectedId={selectedId}
          onView={(b) => {
            choose(b);
            window.scrollTo({ top: 0 });
            document.querySelector("main")?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          emptyMessage={beatsQuery.isLoading ? "Loading beats..." : beats.length === 0 ? "No beats yet. Upload a beat list to get started." : "No beats match this filter."}
        />
      )}

      {dialog?.kind === "upload" && (
        <UploadBeatListWizard
          onClose={closeDialog}
          onImported={() => {
            refresh();
          }}
        />
      )}
      {dialog?.kind === "newBeat" && (
        <NewBeatDialog
          polygon={dialog.polygon}
          onClose={() => {
            closeDialog();
            cancelDrawing();
          }}
          onDone={() => {
            closeDialog();
            cancelDrawing();
            refresh();
          }}
        />
      )}
      {dialog?.kind === "verify" && dialogBeat && <VerifyBeatDialog beat={dialogBeat} onClose={closeDialog} onDone={dialogDone} />}
      {dialog?.kind === "assign" && dialogBeat && <AssignPostmanDialog beat={dialogBeat} onClose={closeDialog} onDone={dialogDone} />}
      {dialog?.kind === "edit" && dialogBeat && <EditBeatDialog beat={dialogBeat} onClose={closeDialog} onDone={dialogDone} />}
    </div>
  );
}
