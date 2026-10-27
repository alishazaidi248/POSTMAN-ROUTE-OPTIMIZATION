import React, { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../common/PrimaryButton";

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSave: (pngDataUrl: string) => void;
  /** Native-only fallback (no DOM canvas there); unused on web, kept so both platform files share one prop shape. */
  onFallbackToPhoto?: () => void;
}

const PAD_HEIGHT = 220;

/**
 * Web only: draws on a real HTML <canvas> and exports it as a PNG data URL directly - nothing to rasterise
 * elsewhere. react-native-web forwards a View's ref to its underlying DOM node, the same way
 * WebMapView.web.tsx gets a container element for maplibre-gl to attach to.
 *
 * The native build has no DOM canvas to draw on - see SignaturePadModal.native.tsx, which offers a photo
 * instead rather than a capture step that cannot actually produce an image.
 */
export function SignaturePadModal({ visible, onCancel, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    if (!visible || !containerRef.current) return;
    setHasStrokes(false);

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(containerRef.current.clientWidth || 0, 280);
    const canvas = document.createElement("canvas");
    canvas.width = width * dpr;
    canvas.height = PAD_HEIGHT * dpr;
    Object.assign(canvas.style, { width: `${width}px`, height: `${PAD_HEIGHT}px`, touchAction: "none", cursor: "crosshair" });
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(canvas);
    canvasRef.current = canvas;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, PAD_HEIGHT);
    ctx.strokeStyle = colors.textPrimary;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const pointFrom = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onPointerDown = (e: PointerEvent) => {
      drawingRef.current = true;
      const { x, y } = pointFrom(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const { x, y } = pointFrom(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasStrokes(true);
    };
    const onPointerUp = () => {
      drawingRef.current = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
    };
  }, [visible]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasStrokes(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Recipient&rsquo;s signature</Text>
          <Text style={styles.subtitle}>Have the recipient sign in the box below</Text>
          <View ref={containerRef as unknown as React.Ref<View>} style={styles.pad} />
          <View style={styles.actions}>
            <PrimaryButton label="Clear" variant="secondary" onPress={clear} style={styles.actionButton} />
            <PrimaryButton label="Cancel" variant="secondary" onPress={onCancel} style={styles.actionButton} />
            <PrimaryButton label="Save" onPress={save} disabled={!hasStrokes} style={styles.actionButton} />
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
  pad: { height: PAD_HEIGHT, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#FFFFFF" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1 }
});
