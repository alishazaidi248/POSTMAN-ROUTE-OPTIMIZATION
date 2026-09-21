import React from "react";
import { Marker } from "@maplibre/maplibre-react-native";
import { StyleSheet, Text, View } from "react-native";
import { MarkerModel } from "../../utils/routeView";
import { stateColor } from "../../utils/mapMarkerColor";

interface Props {
  marker: MarkerModel;
  onPress: (deliveryId: string) => void;
}

// Distinguishable by color AND content/size — the stop number for pending
// stops, ✓ when done, ✕ when failed, larger for the next/selected stop — so
// status is never conveyed by color alone (spec §29).
export function DeliveryMarker({ marker, onPress }: Props) {
  const emphasised = marker.selected || marker.state === "NEXT";
  return (
    <Marker id={marker.deliveryId} lngLat={[marker.longitude, marker.latitude]} onPress={() => onPress(marker.deliveryId)}>
      <View
        style={[
          styles.pin,
          { backgroundColor: stateColor(marker.state) },
          emphasised && styles.pinLarge,
          marker.selected && styles.pinSelected
        ]}
        accessibilityLabel={marker.title}
      >
        <Text style={[styles.label, emphasised && styles.labelLarge]}>{marker.label}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center"
  },
  pinLarge: { width: 38, height: 38, borderRadius: 19 },
  pinSelected: { borderColor: "#111827", borderWidth: 4 },
  label: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  labelLarge: { fontSize: 16 }
});
