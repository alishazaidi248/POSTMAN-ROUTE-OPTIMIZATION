import React from "react";
import { ScrollView, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { DeliveryFilter } from "../../types/delivery";

const FILTERS: DeliveryFilter[] = ["ALL", "PENDING", "COMPLETED", "FAILED", "RESCHEDULED"];
const LABEL: Record<DeliveryFilter, string> = { ALL: "All", PENDING: "Pending", COMPLETED: "Completed", FAILED: "Failed", RESCHEDULED: "Rescheduled" };

interface Props {
  value: DeliveryFilter;
  onChange: (filter: DeliveryFilter) => void;
}

export function FilterChips({ value, onChange }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.row}>
      {FILTERS.map((filter) => {
        const active = filter === value;
        return (
          <Pressable
            key={filter}
            onPress={() => onChange(filter)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filter: ${filter}`}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{LABEL[filter]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // react-native-web's ScrollView applies `flexGrow: 1` as part of its own
  // unconditional base style (node_modules/react-native-web/src/exports/
  // ScrollView/index.js `commonStyle`), regardless of what this component
  // passes — native has no such default. Left unset, this ScrollView became
  // a second flex-growing sibling next to the delivery FlatList (also
  // flex: 1), and the two split the remaining vertical space, leaving a
  // large mostly-empty box around this short one-line filter row. Override
  // it back to content-sized height.
  scrollView: { flexGrow: 0, flexShrink: 0 },
  // `horizontal` on ScrollView makes native inject flexDirection: "row" into
  // the content container automatically; react-native-web does not reliably
  // do the same, so without it explicitly here the chips stack into a tall
  // vertical column instead of a horizontal row (this was the actual bug).
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chip: {
    flexShrink: 0,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: "center"
  },
  chipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: "600" },
  chipTextActive: { color: colors.onPrimary }
});
