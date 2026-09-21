import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { AuthNavigator } from "./AuthNavigator";
import { MainNavigator } from "./MainNavigator";
import { useAuth } from "../hooks/useAuth";
import { LoadingState } from "../components/loading/LoadingState";
import { ChangePasswordScreen } from "../screens/auth/ChangePasswordScreen";

export function RootNavigator() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <LoadingState message="Preparing your session..." />;
  }

  // A temporary password (set by an administrator) is replaced before anything else is shown.
  if (status === "signedIn" && user?.mustChangePassword) return <ChangePasswordScreen />;

  return <NavigationContainer>{status === "signedIn" ? <MainNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
