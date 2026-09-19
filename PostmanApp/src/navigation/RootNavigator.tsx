import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { AuthNavigator } from "./AuthNavigator";
import { MainNavigator } from "./MainNavigator";
import { useAuth } from "../hooks/useAuth";
import { LoadingState } from "../components/loading/LoadingState";

export function RootNavigator() {
  const { status } = useAuth();

  if (status === "loading") {
    return <LoadingState message="Preparing your session..." />;
  }

  return <NavigationContainer>{status === "signedIn" ? <MainNavigator /> : <AuthNavigator />}</NavigationContainer>;
}
