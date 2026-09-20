import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, CompositeNavigationProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Map, Camera, UserLocation } from "@maplibre/maplibre-react-native";
import { MapStackParamList, MainTabParamList } from "../../navigation/types";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useLocation } from "../../hooks/useLocation";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { EmptyState } from "../../components/common/EmptyState";
import { DeliveryMarker } from "../../components/map/DeliveryMarker";
import { RoutePolyline } from "../../components/route/RoutePolyline";
import { RouteSummaryCard } from "../../components/route/RouteSummaryCard";
import { useMapScreenData } from "./useMapScreenData";
import { validateAndLogCoordinates } from "../../utils/coordinates";
import { computeBoundsForPoints, toFlatBounds } from "../../utils/mapBounds";
import { env } from "../../config/env";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../../components/common/PrimaryButton";

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MapStackParamList, "MapHome">,
  BottomTabNavigationProp<MainTabParamList>
>;

// Last-resort fallback only (Bhandup West, matches backend seed data) — used
// solely if bounds can't be computed at all (should be unreachable, since
// the empty-state check below already covers "no plottable stops").
const DEFAULT_CENTER: [number, number] = [72.9345, 19.1436];

// iOS/Android map — @maplibre/maplibre-react-native (native module, requires
// a dev-client build). Web uses a separate implementation: MapScreen.web.tsx.
export function MapScreen() {
  const navigation = useNavigation<Nav>();
  const {
    isLoading,
    isError,
    refetch,
    route,
    statusByDeliveryId,
    completedIds,
    current,
    next,
    recipientNameByDeliveryId,
    unroutedStops
  } = useMapScreenData();
  const { permission, fix, requestPermission } = useLocation("ACTIVE_ROUTE");
  const [mapStyleFailed, setMapStyleFailed] = useState(false);

  if (isLoading) {
    return <LoadingState message="Loading route..." />;
  }

  if (isError) {
    return <ErrorState message="Unable to load your route. Try again." onRetry={refetch} />;
  }

  if (permission !== "GRANTED") {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Location access needed</Text>
        <Text style={styles.permissionBody}>
          {permission === "GPS_DISABLED"
            ? "Turn on device location services to see your position on the map."
            : permission === "PERMANENTLY_DENIED"
            ? "Location was denied. Enable it for this app in your device Settings."
            : "Allow location access to see your position and navigate your route."}
        </Text>
        {permission !== "PERMANENTLY_DENIED" ? (
          <PrimaryButton label="Allow Location" onPress={requestPermission} />
        ) : null}
      </View>
    );
  }

  const stops = route ? route.solution.stops : unroutedStops;
  // Defensive re-validation at render time (in addition to
  // useMapScreenData's own filtering of unroutedStops) — route.solution.stops
  // comes from the backend optimizer and isn't pre-filtered the same way, so
  // a bad geocode there shouldn't be plotted or allowed to skew the bounds.
  const mapStops = validateAndLogCoordinates(
    stops,
    (s) => ({ latitude: s.latitude, longitude: s.longitude }),
    (s) => `route stop ${s.deliveryId}`
  );

  if (mapStops.length === 0) {
    return (
      <EmptyState
        title="No deliveries to show on the map"
        message="Assigned deliveries with a known, valid address will appear here."
      />
    );
  }

  const boundsPoints: [number, number][] = mapStops.map((s) => [s.longitude, s.latitude]);
  if (fix) boundsPoints.push([fix.longitude, fix.latitude]);
  const bounds = computeBoundsForPoints(boundsPoints);

  if (mapStyleFailed) {
    return (
      <ErrorState
        title="Map unavailable"
        message="The map style could not be loaded. Check your connection and try again."
        onRetry={() => setMapStyleFailed(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <Map style={styles.map} mapStyle={env.mapStyleUrl} onDidFailLoadingMap={() => setMapStyleFailed(true)}>
          <Camera
            initialViewState={
              bounds
                ? { bounds: toFlatBounds(bounds), padding: { top: 60, bottom: 60, left: 40, right: 40 } }
                : { center: DEFAULT_CENTER, zoom: 13 }
            }
          />
          <UserLocation accuracy animated />
          {route ? <RoutePolyline stops={mapStops} /> : null}
          {mapStops.map((stop) => (
            <DeliveryMarker
              key={stop.deliveryId}
              stop={stop}
              status={(statusByDeliveryId[stop.deliveryId]?.status as any) ?? "ASSIGNED"}
              isCurrent={current?.deliveryId === stop.deliveryId}
              onPress={(deliveryId) =>
                navigation.navigate("DeliveriesTab", { screen: "DeliveryDetails", params: { deliveryId } })
              }
            />
          ))}
        </Map>
      </View>

      <View style={styles.summaryWrap}>
        {route ? (
          <RouteSummaryCard
            route={route}
            completed={completedIds.size}
            total={stops.length}
            currentStop={current}
            nextStop={next}
            recipientNameByDeliveryId={recipientNameByDeliveryId}
            hasRoadGeometry={false}
          />
        ) : (
          <View style={styles.noRouteBanner}>
            <Text style={styles.noRouteText}>
              No optimized route yet — showing {stops.length} assigned {stops.length === 1 ? "delivery" : "deliveries"}.
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
  summaryWrap: { padding: spacing.md },
  permissionContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  permissionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  permissionBody: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  noRouteBanner: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  noRouteText: { ...typography.body, color: colors.textSecondary, textAlign: "center" }
});
