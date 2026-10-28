import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebMapView } from "../../components/map/WebMapView.web";
import { useTurnByTurnScreen } from "./useTurnByTurnScreen";
import { TurnByTurnStatus } from "./TurnByTurnStatus";
import { InstructionBanner } from "../../components/navigation/InstructionBanner";
import { NavigationFooter } from "../../components/navigation/NavigationFooter";
import { ArrivalPanel } from "../../components/navigation/ArrivalPanel";
import { computeBoundsForPoints, toCornerBounds } from "../../utils/mapBounds";
import { env } from "../../config/env";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

const DEFAULT_CENTER: [number, number] = [72.9345, 19.1436];

/**
 * Turn-by-turn directions in the browser build. The map shows the whole leg rather than following the postman: a
 * browser only shares location over HTTPS (or on localhost), so on a phone opened over the LAN the instructions and
 * the line are there but live progress may not be.
 */
export function TurnByTurnScreen() {
  const s = useTurnByTurnScreen();
  const { nav } = s;
  const [mapFailed, setMapFailed] = useState(false);

  const routePoints = nav.directions?.geometry.coordinates ?? [];
  const bounds = computeBoundsForPoints(
    s.destination ? [...routePoints, [s.destination.longitude, s.destination.latitude]] : routePoints
  );
  const fitKey = nav.directions ? `${nav.directions.mode}|${nav.directions.from.latitude},${nav.directions.from.longitude}` : "none";
  const showArrival = nav.arrived && s.delivery && s.status;

  return (
    <View style={styles.container}>
      <View style={styles.mapArea}>
        {mapFailed ? (
          <View style={styles.mapFallback}>
            <Text style={styles.fallbackText}>The map couldn&rsquo;t load. The directions below still work.</Text>
          </View>
        ) : (
          <WebMapView
            styleUrl={env.mapStyleUrl}
            center={s.fix ? [s.fix.longitude, s.fix.latitude] : s.destination ? [s.destination.longitude, s.destination.latitude] : DEFAULT_CENTER}
            bounds={bounds ? toCornerBounds(bounds) : null}
            fitKey={fitKey}
            markers={
              s.destination
                ? [
                    {
                      deliveryId: s.delivery!.id,
                      latitude: s.destination.latitude,
                      longitude: s.destination.longitude,
                      label: "✉",
                      state: "NEXT",
                      selected: false,
                      title: s.delivery!.recipient.name
                    }
                  ]
                : []
            }
            routeLine={nav.directions ? { coordinates: nav.directions.geometry.coordinates, source: nav.directions.source } : null}
            start={null}
            userFix={s.fix ? { latitude: s.fix.latitude, longitude: s.fix.longitude } : null}
            selectedDeliveryId={null}
            onSelectDelivery={() => undefined}
            onStyleError={() => setMapFailed(true)}
          />
        )}

        <View style={styles.top} pointerEvents="box-none">
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
          {s.permission !== "GRANTED" ? (
            <Pressable onPress={s.requestPermission} accessibilityRole="button" accessibilityLabel="Allow location" style={styles.chip}>
              <Text style={styles.chipText}>
                Allow location so the directions can follow you (browsers only share it over HTTPS or on this computer)
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {showArrival ? (
        <ArrivalPanel delivery={s.delivery!} status={s.status!} onOpenDetails={s.openDetails} onKeepNavigating={nav.dismissArrival} onFinish={s.end} />
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapArea: { flex: 1 },
  mapFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  fallbackText: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  top: { position: "absolute", top: spacing.sm, left: spacing.sm, right: spacing.sm, gap: spacing.xs },
  chip: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  chipText: { ...typography.caption, color: colors.textPrimary }
});
