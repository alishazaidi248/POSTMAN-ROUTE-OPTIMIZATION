import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A two- or three-way switch ("Today | History"). One option is always selected. */
export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      <View style={styles.track}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={o.label}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  track: { flexDirection: "row", backgroundColor: colors.neutralBg, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 38, borderRadius: radius.md - 3 },
  segmentActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  text: { ...typography.bodyStrong, color: colors.textSecondary },
  textActive: { color: colors.textPrimary }
});
