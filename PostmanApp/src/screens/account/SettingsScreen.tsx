import React, { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import * as locationService from "../../services/locationService";
import { requestNotificationPermission } from "../../services/notificationService";
import { useAuthStore } from "../../store/authStore";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { LocationPermissionState } from "../../types/location";

const LOCATION_LABEL: Record<LocationPermissionState, string> = {
  GRANTED: "Allowed",
  DENIED: "Not allowed",
  PERMANENTLY_DENIED: "Blocked in phone settings",
  UNKNOWN: "Not asked yet",
  GPS_DISABLED: "Location is switched off on this phone"
};

/** App information and the two permissions the app uses (location, notifications). */
export function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>("UNKNOWN");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    locationService.getPermissionState().then(setLocationPermission);
  }, []);

  const handleRequestNotifications = async () => {
    setNotificationsEnabled(await requestNotificationPermission());
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Location</Text>
        <Text style={styles.value}>{LOCATION_LABEL[locationPermission]}</Text>
        <Text style={styles.caption}>Your position is used to start your route where you are and to show you on the map.</Text>
        {locationPermission !== "GRANTED" ? (
          <PrimaryButton
            label={locationPermission === "PERMANENTLY_DENIED" ? "Open Phone Settings" : "Allow Location"}
            variant="secondary"
            onPress={async () => {
              if (locationPermission === "PERMANENTLY_DENIED") {
                void Linking.openSettings();
                return;
              }
              setLocationPermission(await locationService.requestPermission());
            }}
          />
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>Reminders</Text>
            <Text style={styles.caption}>Allow reminders on this phone, for example when an update is waiting to be sent.</Text>
          </View>
          <Switch value={notificationsEnabled} onValueChange={handleRequestNotifications} accessibilityLabel="Allow reminders" />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>About</Text>
        <Info label="App version" value={Constants.expoConfig?.version ?? "1.0.0"} />
        <Info label="Signed in as" value={user?.email ?? "—"} />
        <Text style={styles.caption}>For help, contact your post office administrator.</Text>
      </View>
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.valueSmall}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  flex: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  eyebrow: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.sectionTitle, color: colors.textPrimary },
  valueSmall: { ...typography.body, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  info: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }
});
