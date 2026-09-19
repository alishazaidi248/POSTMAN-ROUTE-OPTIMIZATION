import React from "react";
import { Marker } from "@maplibre/maplibre-react-native";
import { StyleSheet, View } from "react-native";
import { OptimizationStop } from "../../types/route";
import { DeliveryStatus } from "../../types/delivery";
import { markerColor } from "../../utils/mapMarkerColor";

interface Props {
  stop: OptimizationStop;
  status: DeliveryStatus;
  isCurrent: boolean;
  onPress: (deliveryId: string) => void;
}

// Distinguishable by both color and shape/size (current stop is larger) so
// status is never conveyed by color alone (spec §29).
export function DeliveryMarker({ stop, status, isCurrent, onPress }: Props) {
  const color = markerColor(status, isCurrent);
  return (
    <Marker
      id={stop.deliveryId}
      lngLat={[stop.longitude, stop.latitude]}
      onPress={() => onPress(stop.deliveryId)}
    >
      <View
        style={[styles.pin, { backgroundColor: color }, isCurrent && styles.pinCurrent]}
        accessibilityLabel={`Stop ${stop.sequence}, ${status}`}
      />
    </Marker>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#FFFFFF"
  },
  pinCurrent: { width: 26, height: 26, borderRadius: 13, borderWidth: 3 }
});
