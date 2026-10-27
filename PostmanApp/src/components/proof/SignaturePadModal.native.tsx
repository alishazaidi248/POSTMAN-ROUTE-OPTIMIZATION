import React from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../common/PrimaryButton";

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSave: (pngDataUrl: string) => void;
  /** There is no on-screen signature capture on a native build yet (see below) - this is the only way forward. */
  onFallbackToPhoto?: () => void;
}

/**
 * Native (iOS/Android) has no DOM `<canvas>` to draw a signature on and rasterise - unlike
 * SignaturePadModal.web.tsx. Building that here would need either a native screenshot library
 * (e.g. react-native-view-shot) this project does not yet depend on and that could not be verified on a
 * real device/emulator in this environment, or sending raw stroke coordinates to the backend to rasterise
 * server-side (a bigger change, and still unverified end-to-end without a device). Rather than ship a
 * capture step that silently cannot produce an image, this offers the one proof method that does work today.
 */
export function SignaturePadModal({ visible, onCancel, onSave, onFallbackToPhoto }: Props) {
  // Keep both platform files to the same prop shape without an "unused" lint warning on web's onSave.
  void onSave;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Signature not available here yet</Text>
          <Text style={styles.subtitle}>
            This post office requires proof of delivery, but on-screen signature capture isn&rsquo;t built for this app
            yet. Take a photo of the delivery instead.
          </Text>
          <View style={styles.actions}>
            <PrimaryButton label="Cancel" variant="secondary" onPress={onCancel} style={styles.actionButton} />
            <PrimaryButton label="Take Photo Instead" onPress={() => onFallbackToPhoto?.()} style={styles.actionButton} />
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
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1 }
});
