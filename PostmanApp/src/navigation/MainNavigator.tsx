import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text } from "react-native";
import { AccountStackParamList, DeliveriesStackParamList, MainTabParamList, MapStackParamList } from "./types";
import { DeliveriesScreen } from "../screens/deliveries/DeliveriesScreen";
import { DeliveryDetailsScreen } from "../screens/deliveries/DeliveryDetailsScreen";
import { MapScreen } from "../screens/map/MapScreen";
import { AccountScreen } from "../screens/account/AccountScreen";
import { ProfileScreen } from "../screens/account/ProfileScreen";
import { SettingsScreen } from "../screens/account/SettingsScreen";
import { IdCardScreen } from "../screens/account/IdCardScreen";
import { colors } from "../theme/colors";

const Tab = createBottomTabNavigator<MainTabParamList>();
const DeliveriesStack = createNativeStackNavigator<DeliveriesStackParamList>();
const MapStack = createNativeStackNavigator<MapStackParamList>();
const AccountStack = createNativeStackNavigator<AccountStackParamList>();

function DeliveriesStackNavigator() {
  return (
    <DeliveriesStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: colors.onPrimary }}>
      <DeliveriesStack.Screen name="DeliveriesList" component={DeliveriesScreen} options={{ title: "Deliveries" }} />
      <DeliveriesStack.Screen name="DeliveryDetails" component={DeliveryDetailsScreen} options={{ title: "Delivery Details" }} />
    </DeliveriesStack.Navigator>
  );
}

function MapStackNavigator() {
  return (
    <MapStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: colors.onPrimary }}>
      <MapStack.Screen name="MapHome" component={MapScreen} options={{ title: "Route Map" }} />
    </MapStack.Navigator>
  );
}

function AccountStackNavigator() {
  return (
    <AccountStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.primary }, headerTintColor: colors.onPrimary }}>
      <AccountStack.Screen name="AccountHome" component={AccountScreen} options={{ title: "Account" }} />
      <AccountStack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <AccountStack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <AccountStack.Screen name="IdCard" component={IdCardScreen} options={{ title: "ID Card" }} />
    </AccountStack.Navigator>
  );
}

// Exactly three bottom tabs (spec §6) — do not add more. Secondary screens
// live in each tab's own stack.
export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { height: 60, paddingBottom: 8, paddingTop: 6 }
      }}
    >
      <Tab.Screen
        name="DeliveriesTab"
        component={DeliveriesStackNavigator}
        options={{ title: "Deliveries", tabBarIcon: ({ color }) => <TabGlyph glyph="D" color={color} /> }}
      />
      <Tab.Screen
        name="MapTab"
        component={MapStackNavigator}
        options={{ title: "Map", tabBarIcon: ({ color }) => <TabGlyph glyph="M" color={color} /> }}
      />
      <Tab.Screen
        name="AccountTab"
        component={AccountStackNavigator}
        options={{ title: "Account", tabBarIcon: ({ color }) => <TabGlyph glyph="A" color={color} /> }}
      />
    </Tab.Navigator>
  );
}

// Text-glyph tab icons — no icon font dependency needed beyond what Expo
// already ships, keeps the bundle lean.
function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontWeight: "700", fontSize: 16 }}>{glyph}</Text>;
}
