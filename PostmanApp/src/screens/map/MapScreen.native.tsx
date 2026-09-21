import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, CompositeNavigationProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Map, Camera, Marker, UserLocation, type CameraRef } from "@maplibre/maplibre-react-native";
import { MapStackParamList, MainTabParamList } from "../../navigation/types";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useLocation } from "../../hooks/useLocation";
import { useReoptimizeRoute } from "../../hooks/useRoute";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { useRefreshStaleOnFocus } from "../../hooks/useRefreshStaleOnFocus";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { EmptyState } from "../../components/common/EmptyState";
import { OfflineBanner } from "../../components/common/OfflineBanner";
import { ConflictBanner } from "../../components/common/ConflictBanner";
import { DeliveryMarker } from "../../components/map/DeliveryMarker";
import { NextStopBanner } from "../../components/map/NextStopBanner";
import { SelectedDeliverySheet } from "../../components/map/SelectedDeliverySheet";
import { RoutePolyline } from "../../components/route/RoutePolyline";
import { RouteSummaryCard } from "../../components/route/RouteSummaryCard";
import { useMapScreenData } from "./useMapScreenData";
import { computeBoundsForPoints, toFlatBounds } from "../../utils/mapBounds";
import { startLabel } from "../../utils/routeView";
import { notify } from "../../utils/alerts";
import { env } from "../../config/env";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MapStackParamList, "MapHome">,
  BottomTabNavigationProp<MainTabParamList>
>;

const REFRESH_ON_FOCUS = [["deliveries"], ["route"]] as const;

// Last-resort camera centre only if bounds can't be computed at all (the
// empty-state check below already covers "nothing plottable"). Matches the
// backend seed data's post office; the real view always fits the actual stops.
const DEFAULT_CENTER: [number, number] = [72.9345, 19.1436];

// iOS/Android map — @maplibre/maplibre-react-native (native module, requires
// a dev-client build). Web uses a separate implementation: MapScreen.web.tsx.
// Both consume useMapScreenData so numbering, next stop and completed/pending
// state can never differ between platforms or from the Deliveries tab.
export function MapScreen() {
  const navigation = useNavigation<Nav>();
  useRefreshStaleOnFocus(REFRESH_ON_FOCUS);
  const data = useMapScreenData();
  const { permission, fix, requestPermission } = useLocation("ACTIVE_ROUTE");
  const { isOnline, queueLength, conflicts, clearConflict } = useOfflineSync();
  const reoptimize = useReoptimizeRoute();
  const [mapStyleFailed, setMapStyleFailed] = useState(false);
  const cameraRef = useRef<CameraRef>(null);

  const { route, markers, views, next, selectedView, selectedDeliveryId } = data;

  // Fly to whichever delivery gets selected (list tap, marker tap, banner).
  useEffect(() => {
    if (!selectedDeliveryId) return;
    const target = markers.find((m) => m.deliveryId === selectedDeliveryId);
    if (!target) return;
    cameraRef.current?.flyTo({ center: [target.longitude, target.latitude], zoom: 15.5, duration: 600 });
    // Only when the selection changes — not on every marker refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeliveryId]);

  if (data.isLoading) {
    return <LoadingState message="Loading route..." />;
  }

  if (data.isError) {
    return <ErrorState message="Unable to load your route. Try again." onRetry={data.refetch} />;
  }

  if (markers.length === 0) {
    return (
      <EmptyState
        title="No deliveries to show on the map"
        message="Assigned deliveries with a known, valid address will appear here."
      />
    );
  }

  if (mapStyleFailed) {
    return (
      <ErrorState
        title="Map unavailable"
        message="The map style could not be loaded. Check your connection and try again."
        onRetry={() => setMapStyleFailed(false)}
      />
    );
  }

  const boundsPoints: [number, number][] = markers.map((m) => [m.longitude, m.latitude]);
  if (data.start) boundsPoints.push([data.start.longitude, data.start.latitude]);
  const bounds = computeBoundsForPoints(boundsPoints);

  const recalculate = () =>
    reoptimize.mutate(
      { trigger: "MANUAL", start: fix ? { latitude: fix.latitude, longitude: fix.longitude } : undefined },
      { onError: (err) => notify("Couldn't recalculate the route", err instanceof Error ? err.message : "Please try again.") }
    );

  const allDone = views.length > 0 && data.remaining === 0;

  return (
    <View style={styles.container}>
      <OfflineBanner isOnline={isOnline} queueLength={queueLength} />
      <ConflictBanner conflicts={conflicts} nameByDeliveryId={data.recipientNameByDeliveryId} onDismiss={clearConflict} />

      <View style={styles.mapContainer}>
        <Map style={styles.map} mapStyle={env.mapStyleUrl} onDidFailLoadingMap={() => setMapStyleFailed(true)}>
          <Camera
            ref={cameraRef}
            initialViewState={
              bounds
                ? { bounds: toFlatBounds(bounds), padding: { top: 190, bottom: 60, left: 40, right: 40 } }
                : { center: DEFAULT_CENTER, zoom: 13 }
            }
          />
          {permission === "GRANTED" ? <UserLocation accuracy animated /> : null}
          {data.routeLine ? <RoutePolyline line={data.routeLine} /> : null}
          {data.start ? (
            <Marker id="route-start" lngLat={[data.start.longitude, data.start.latitude]}>
              <View style={styles.startPin} accessibilityLabel={startLabel(data.start.source)}>
                <Text style={styles.startText}>S</Text>
              </View>
            </Marker>
          ) : null}
          {markers.map((marker) => (
            <DeliveryMarker key={marker.deliveryId} marker={marker} onPress={(id) => data.select(id, "map")} />
          ))}
        </Map>

        <View style={styles.overlay} pointerEvents="box-none">
          <NextStopBanner
            next={next}
            total={data.total}
            allDone={allDone}
            recalculating={reoptimize.isPending}
            onRecalculate={recalculate}
            onFocusNext={() => next && data.select(next.delivery.id, "map")}
          />
          {permission !== "GRANTED" && permission !== "PERMANENTLY_DENIED" ? (
            <Pressable onPress={requestPermission} accessibilityRole="button" accessibilityLabel="Allow Location" style={styles.chip}>
              <Text style={styles.chipText}>Allow location to see where you are on the map</Text>
            </Pressable>
          ) : null}
          {data.routeError && !route ? (
            <Pressable onPress={data.refetch} accessibilityRole="button" accessibilityLabel="Retry route" style={styles.chipWarn}>
              <Text style={styles.chipText}>Couldn&rsquo;t load the route — showing delivery locations only. Tap to retry.</Text>
            </Pressable>
          ) : null}
          {data.routeIsStale ? (
            <View style={styles.chipWarn}>
              <Text style={styles.chipText}>Route couldn&rsquo;t be refreshed — showing the last one.</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.bottom}>
        {selectedView ? (
          <SelectedDeliverySheet
            view={selectedView}
            onClose={() => data.select(null)}
            onOpenDetails={() =>
              navigation.navigate("DeliveriesTab", {
                screen: "DeliveryDetails",
                params: { deliveryId: selectedView.delivery.id }
              })
            }
          />
        ) : route ? (
          <RouteSummaryCard
            compact
            route={route}
            completed={data.doneCount}
            total={data.total}
            currentStop={data.pendingRouteStops[0] ?? null}
            nextStop={data.pendingRouteStops[1] ?? null}
            recipientNameByDeliveryId={data.recipientNameByDeliveryId}
            hasRoadGeometry={data.roadGeometry}
          />
        ) : (
          <View style={styles.noRouteBanner}>
            <Text style={styles.noRouteText}>
              No optimized route yet — showing {markers.length} delivery {markers.length === 1 ? "location" : "locations"}.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  overlay: { position: "absolute", top: spacing.sm, left: spacing.sm, right: spacing.sm, gap: spacing.xs },
  bottom: { padding: spacing.md, gap: spacing.sm },
  startPin: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.mapSelf,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  startText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  chip: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  chipWarn: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.sm },
  chipText: { ...typography.caption, color: colors.textPrimary },
  noRouteBanner: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  noRouteText: { ...typography.body, color: colors.textSecondary, textAlign: "center" }
});
