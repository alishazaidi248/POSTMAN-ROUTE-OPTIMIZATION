import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AccountStackParamList, DeliveriesStackParamList, MainTabParamList, MapStackParamList } from "./types";
import { HomeScreen } from "../screens/home/HomeScreen";
import { DeliveriesScreen } from "../screens/deliveries/DeliveriesScreen";
import { DeliveryDetailsScreen } from "../screens/deliveries/DeliveryDetailsScreen";
import { MapScreen } from "../screens/map/MapScreen";
import { AccountScreen } from "../screens/account/AccountScreen";
import { ProfileScreen } from "../screens/account/ProfileScreen";
import { SettingsScreen } from "../screens/account/SettingsScreen";
import { IdCardScreen } from "../screens/account/IdCardScreen";
import { NotificationsScreen } from "../screens/account/NotificationsScreen";
import { OfflineSyncScreen } from "../screens/account/OfflineSyncScreen";
import { Icon, IconName } from "../components/common/Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePushRegistration } from "../hooks/usePushRegistration";
import { colors } from "../theme/colors";

const Tab = createBottomTabNavigator<MainTabParamList>();
const DeliveriesStack = createNativeStackNavigator<DeliveriesStackParamList>();
const MapStack = createNativeStackNavigator<MapStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();

// Quiet white headers with dark titles: the content (deliveries, the map) is the focus, not the chrome.
const headerOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontWeight: "600" as const, fontSize: 17 },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background }
};

function DeliveriesStackNavigator() {
  return (
    <DeliveriesStack.Navigator screenOptions={headerOptions}>
      <DeliveriesStack.Screen name="DeliveriesList" component={DeliveriesScreen} options={{ title: "Deliveries" }} />
      <DeliveriesStack.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} options={{ title: "Delivery" }} />
    </DeliveriesStack.Navigator>
  );
}

function MapStackNavigator() {
  return (
    <MapStack.Navigator screenOptions={headerOptions}>
      <MapStack.Screen name="MapHome" component={MapScreen} options={{ title: "Route Map" }} />
    </MapStack.Navigator>
  );
}

function AccountStackNavigator() {
  return (
    <AccountStack.Navigator screenOptions={headerOptions}>
      <AccountStack.Screen name="AccountHome" component={AccountScreen} options={{ title: "Account" }} />
      <AccountStack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <AccountStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications" }} />
      <AccountStack.Screen name="OfflineSync" component={OfflineSyncScreen} options={{ title: "Offline Sync" }} />
      <AccountStack.Screen name="Settings" component={SettingsScreen} options={{ title: "App Information" }} />
      <AccountStack.Screen name="IdCard" component={IdCardScreen} options={{ title: "ID Card" }} />
    </AccountStack.Navigator>
  );
}

function tabIcon(name: IconName) {
  function TabIcon({ color }: { color: string }) {
    return <Icon name={name} color={color} />;
  }
  return TabIcon;
}

// Four bottom tabs: Home (today at a glance), Deliveries, Map and Account. Secondary screens live in each
// tab's own stack.
export function MainNavigator() {
  // The bar's height follows the device's own bottom inset (gesture bar, home indicator) instead of a fixed number, and the
  // label gets a line height taller than its font, so the text is never clipped at the bottom edge.
  usePushRegistration();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textDisabled,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 15, fontWeight: "600" },
        tabBarAllowFontScaling: false,
        tabBarStyle: { height: 56 + bottom, paddingBottom: bottom, paddingTop: 6, backgroundColor: colors.surface, borderTopColor: colors.border }
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
      <Tab.Screen name="DeliveriesTab" component={DeliveriesStackNavigator} options={{ title: "Deliveries", tabBarIcon: tabIcon("list") }} />
      <Tab.Screen name="MapTab" component={MapStackNavigator} options={{ title: "Map", tabBarIcon: tabIcon("map") }} />
      <Tab.Screen name="AccountTab" component={AccountStackNavigator} options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
    </Tab.Navigator>
  );
}
