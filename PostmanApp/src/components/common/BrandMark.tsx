import React, { useState } from "react";
import { Image } from "react-native";
import { Icon } from "./Icon";
import { colors } from "../../theme/colors";

// Always resolves: Metro needs a require() path to exist at bundle time, so the placeholder is a real, checked-in
// file (see assets/branding/README.md for what to replace it with).
const logo = require("../../../assets/branding/india-post-logo.png") as number;

interface Props {
  size?: number;
}

/** The India Post mark: the logo at assets/branding/india-post-logo.png, falling back to the app's generic package
 * badge if the image fails to load (a corrupt or missing replacement degrades gracefully, never a broken image). */
export function BrandMark({ size = 30 }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Icon name="package" size={size} color={colors.onPrimary} />;
  return <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" onError={() => setFailed(true)} />;
}
