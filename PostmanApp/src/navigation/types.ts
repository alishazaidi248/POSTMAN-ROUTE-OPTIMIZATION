import { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
};

export type DeliveriesStackParamList = {
  DeliveriesList: undefined;
  DeliveryDetails: { deliveryId: string };
};

export type AccountStackParamList = {
  AccountHome: undefined;
  Profile: undefined;
  Notifications: undefined;
  OfflineSync: undefined;
  Settings: undefined;
  IdCard: undefined;
};

export type MapStackParamList = {
  MapHome: undefined;
};

export type MainTabParamList = {
  HomeTab: undefined;
  DeliveriesTab: NavigatorScreenParams<DeliveriesStackParamList>;
  MapTab: NavigatorScreenParams<MapStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

/** Signed in: the four tabs, with full-screen turn-by-turn navigation opening over them (and over the tab bar). */
export type SignedInStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList>;
  TurnByTurn: { deliveryId: string };
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
} & SignedInStackParamList;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
