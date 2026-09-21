import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { resolveAssetUrl } from "../../utils/assetUrl";
import { typography } from "../../theme/typography";

/** "Ramesh Kadam" -> "RK". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const TINTS: [string, string][] = [
  ["#E8EEF7", "#2F4F7F"],
  ["#EAF3EC", "#2F6B47"],
  ["#F6EDE4", "#8A5A2B"],
  ["#EEE9F5", "#5B3F8A"],
  ["#F4E9EE", "#8A3F5B"],
  ["#E6F1F2", "#2B6B73"]
];

function tintFor(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

interface Props {
  name: string;
  /** The postman's uploaded picture (a server path). Without one - or if it fails to load - their initials show. */
  photoUrl?: string | null;
  size?: number;
}

export function Avatar({ name, photoUrl, size = 44 }: Props) {
  const uri = resolveAssetUrl(photoUrl);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [bg, fg] = tintFor(name);
  const showPhoto = !!uri && failedUri !== uri;

  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
      accessibilityRole="image"
      accessibilityLabel={showPhoto ? `Photo of ${name}` : `${name}, initials`}
    >
      {showPhoto ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" onError={() => setFailedUri(uri)} />
      ) : (
        <Text style={[typography.bodyStrong, { color: fg, fontSize: Math.max(12, Math.round(size * 0.38)) }]}>{initialsOf(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", overflow: "hidden" }
});
