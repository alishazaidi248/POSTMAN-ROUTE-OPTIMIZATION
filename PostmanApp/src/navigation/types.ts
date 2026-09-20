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
  Settings: undefined;
  IdCard: undefined;
};

export type MapStackParamList = {
  MapHome: undefined;
};

export type MainTabParamList = {
  DeliveriesTab: NavigatorScreenParams<DeliveriesStackParamList>;
  MapTab: NavigatorScreenParams<MapStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
