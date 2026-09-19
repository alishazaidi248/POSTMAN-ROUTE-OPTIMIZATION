import React, { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as locationService from "../../services/locationService";
import { requestNotificationPermission } from "../../services/notificationService";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { LocationPermissionState } from "../../types/location";

export function SettingsScreen() {
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>("UNKNOWN");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    locationService.getPermissionState().then(setLocationPermission);
  }, []);

  const handleRequestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Location Permission</Text>
        <Text style={styles.value}>{locationPermission}</Text>
        {locationPermission !== "GRANTED" ? (
          <PrimaryButton
            label={locationPermission === "PERMANENTLY_DENIED" ? "Open App Settings" : "Allow Location"}
            variant="secondary"
            onPress={async () => {
              if (locationPermission === "PERMANENTLY_DENIED") {
                Linking.openSettings();
                return;
              }
              const next = await locationService.requestPermission();
              setLocationPermission(next);
            }}
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <Text style={styles.caption}>
              Local reminders only (e.g. sync retries). Server-sent push notifications are not yet available — see
              docs/mobile-architecture.md.
            </Text>
          </View>
          <Switch value={notificationsEnabled} onValueChange={handleRequestNotifications} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.caption}>Postman App connects to your post office&rsquo;s existing backend over the internet.</Text>
        <Text style={styles.caption}>For help, contact your post office administrator.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  value: { ...typography.body, color: colors.textSecondary },
  caption: { ...typography.caption, color: colors.textSecondary },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: spacing.md }
});
