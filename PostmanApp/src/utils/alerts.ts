import { Alert, Platform } from "react-native";

/**
 * react-native-web's Alert.alert() is a complete no-op (it never invokes any
 * button's onPress) — see node_modules/react-native-web/src/exports/Alert.
 * These wrappers give the same call sites working behavior on web via the
 * browser's native confirm()/alert(), while native platforms keep using the
 * real Alert.alert (with its nicer UI and button styling).
 */

export function notify(title: string, message: string): void {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export function confirmAction(title: string, message: string, confirmLabel = "Confirm"): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) }
    ]);
  });
}
