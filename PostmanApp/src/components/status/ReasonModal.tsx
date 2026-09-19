import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../common/PrimaryButton";
import { statusLabel } from "../../utils/status";
import { DeliveryStatus } from "../../types/delivery";

interface Props {
  visible: boolean;
  targetStatus: DeliveryStatus | null;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function ReasonModal({ visible, targetStatus, submitting, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState("");

  if (!targetStatus) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{statusLabel(targetStatus)}</Text>
          <Text style={styles.subtitle}>Add a short note (optional)</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Recipient not home after two attempts"
            placeholderTextColor={colors.textDisabled}
            multiline
            maxLength={500}
            accessibilityLabel="Reason for status change"
          />
          <View style={styles.actions}>
            <PrimaryButton label="Cancel" variant="secondary" onPress={onCancel} disabled={submitting} />
            <PrimaryButton
              label="Confirm"
              onPress={() => onConfirm(reason.trim())}
              loading={submitting}
              disabled={submitting}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    ...typography.body,
    color: colors.textPrimary
  },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }
});
