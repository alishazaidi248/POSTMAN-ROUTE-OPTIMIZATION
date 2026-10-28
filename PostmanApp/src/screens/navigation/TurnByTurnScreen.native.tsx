import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Map, Camera, Marker, UserLocation, type TrackUserLocationChangeEvent } from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import { useTurnByTurnScreen } from "./useTurnByTurnScreen";
import { TurnByTurnStatus } from "./TurnByTurnStatus";
import { InstructionBanner } from "../../components/navigation/InstructionBanner";
import { NavigationFooter } from "../../components/navigation/NavigationFooter";
import { ArrivalPanel } from "../../components/navigation/ArrivalPanel";
import { RoutePolyline } from "../../components/route/RoutePolyline";
import { env } from "../../config/env";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

// Close enough to read street names at cycling speed; tilted so the road ahead fills the screen.
const FOLLOW_ZOOM = 17;
const FOLLOW_PITCH = 45;

/**
 * Turn-by-turn directions inside the app (phone). The camera follows the postman and turns with their direction of
 * travel; dragging the map stops following until "Re-centre" is tapped.
 */
export function TurnByTurnScreen() {
  const insets = useSafeAreaInsets();
  const s = useTurnByTurnScreen();
  const { nav } = s;
  const [following, setFollowing] = useState(true);
  const [mapFailed, setMapFailed] = useState(false);

  const located = s.permission === "GRANTED";
  const start = nav.directions?.from ?? s.fix ?? s.destination;
  const showArrival = nav.arrived && s.delivery && s.status;

  return (
    <View style={styles.container}>
      {mapFailed ? (
        <View style={[styles.map, styles.mapFallback]}>
          <Text style={styles.fallbackText}>The map couldn&rsquo;t load. The directions below still work.</Text>
        </View>
      ) : (
        <Map style={styles.map} mapStyle={env.mapStyleUrl} onDidFailLoadingMap={() => setMapFailed(true)}>
          <Camera
            initialViewState={start ? { center: [start.longitude, start.latitude], zoom: FOLLOW_ZOOM } : undefined}
            trackUserLocation={located && following ? "course" : undefined}
            onTrackUserLocationChange={(e: NativeSyntheticEvent<TrackUserLocationChangeEvent>) => {
              if (e.nativeEvent.trackUserLocation === null) setFollowing(false);
            }}
            {...(located && following ? { zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH } : {})}
          />
          {located ? <UserLocation animated accuracy heading /> : null}
          {nav.directions ? (
            <RoutePolyline line={{ coordinates: nav.directions.geometry.coordinates, source: nav.directions.source }} />
          ) : null}
          {s.destination ? (
            <Marker id="destination" lngLat={[s.destination.longitude, s.destination.latitude]}>
              <View style={styles.destination} accessibilityLabel="Delivery address">
                <Text style={styles.destinationText}>✉</Text>
              </View>
            </Marker>
          ) : null}
        </Map>
      )}

      <View style={[styles.top, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        {nav.phase === "READY" && nav.directions ? (
          <InstructionBanner directions={nav.directions} progress={nav.progress} rerouting={nav.rerouting} />
        ) : (
          <TurnByTurnStatus
            phase={nav.phase}
            error={nav.error}
            hasDelivery={!!s.delivery}
            deliveryLoading={s.deliveryQuery.isLoading}
            onRetry={nav.retry}
            onOpenGoogleMaps={s.openGoogleMaps}
            onEnd={s.end}
          />
        )}
        {!located ? (
          <Pressable onPress={s.requestPermission} accessibilityRole="button" accessibilityLabel="Allow location" style={styles.chip}>
            <Text style={styles.chipText}>Allow location so the directions can follow you</Text>
          </Pressable>
        ) : null}
      </View>

      {located && !following && !mapFailed ? (
        <Pressable
          onPress={() => setFollowing(true)}
          accessibilityRole="button"
          accessibilityLabel="Re-centre"
          style={[styles.recentre, { bottom: (showArrival ? 260 : 150) + insets.bottom }]}
        >
          <Text style={styles.recentreText}>Re-centre</Text>
        </Pressable>
      ) : null}

      <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.surface }}>
        {showArrival ? (
          <ArrivalPanel
            delivery={s.delivery!}
            status={s.status!}
            onOpenDetails={s.openDetails}
            onKeepNavigating={nav.dismissArrival}
            onFinish={s.end}
          />
        ) : (
          <NavigationFooter
            recipientName={s.delivery?.recipient.name ?? ""}
            remainingMeters={nav.progress?.remainingMeters ?? nav.directions?.distanceMeters ?? null}
            remainingSeconds={nav.progress?.remainingSeconds ?? nav.directions?.durationSeconds ?? null}
          arrivalAt={nav.arrivalAt}
            mode={nav.mode}
            onModeChange={nav.setMode}
            onOpenGoogleMaps={s.openGoogleMaps}
            onEnd={s.end}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  mapFallback: { alignItems: "center", justifyContent: "center", padding: spacing.xl },
  fallbackText: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  top: { position: "absolute", left: spacing.sm, right: spacing.sm, gap: spacing.xs },
  chip: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  chipText: { ...typography.caption, color: colors.textPrimary },
  recentre: {
    position: "absolute",
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border
  },
  recentreText: { ...typography.bodyStrong, color: colors.mapCurrent },
  destination: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  destinationText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" }
});
