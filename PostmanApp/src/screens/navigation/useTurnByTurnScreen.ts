import { useCallback } from "react";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SignedInStackParamList } from "../../navigation/types";
import { useDelivery, usePendingStatusOverrides } from "../../hooks/useDeliveries";
import { useLocation } from "../../hooks/useLocation";
import { useTurnByTurn } from "../../hooks/useTurnByTurn";
import { useKeepScreenOn } from "../../hooks/useKeepScreenOn";
import { openNavigation } from "../../utils/navigation";
import { notify } from "../../utils/alerts";

type Route = RouteProp<SignedInStackParamList, "TurnByTurn">;
type Nav = NativeStackNavigationProp<SignedInStackParamList, "TurnByTurn">;

/** Everything the turn-by-turn screen does, apart from drawing the map (which differs between phone and web). */
export function useTurnByTurnScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const deliveryQuery = useDelivery(params.deliveryId);
  const overrides = usePendingStatusOverrides();
  const { permission, fix, requestPermission } = useLocation("NAVIGATING");
  const nav = useTurnByTurn(params.deliveryId, fix, permission);
  useKeepScreenOn("turn-by-turn");

  const delivery = deliveryQuery.data ?? null;
  const status = delivery ? (overrides[delivery.id] ?? delivery.status) : null;
  const destination =
    delivery && delivery.address.latitude != null && delivery.address.longitude != null
      ? { latitude: delivery.address.latitude, longitude: delivery.address.longitude }
      : null;

  const openGoogleMaps = useCallback(async () => {
    if (!delivery) return;
    const opened = await openNavigation({
      latitude: delivery.address.latitude ?? null,
      longitude: delivery.address.longitude ?? null,
      address: delivery.address,
      label: delivery.recipient.name
    });
    if (!opened) notify("Couldn't open Google Maps", "No maps app could be opened on this device.");
  }, [delivery]);

  const end = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Main", { screen: "MapTab", params: { screen: "MapHome" } });
  }, [navigation]);

  const openDetails = useCallback(() => {
    navigation.navigate("Main", {
      screen: "DeliveriesTab",
      params: { screen: "DeliveryDetails", params: { deliveryId: params.deliveryId } }
    });
  }, [navigation, params.deliveryId]);

  return { deliveryQuery, delivery, status, destination, permission, fix, requestPermission, nav, openGoogleMaps, end, openDetails };
}
