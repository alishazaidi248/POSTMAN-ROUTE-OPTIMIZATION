import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

export interface ProofPhoto {
  /** A file inside the app's own storage: it survives the app being closed while the phone is offline. */
  uri: string;
  capturedAt: string;
}

export type ProofResult = { ok: true; photo: ProofPhoto } | { ok: false; reason: "PERMISSION_DENIED" | "CANCELLED" | "FAILED" };

/** Same shape for a signature: `photo` just means "the captured proof file" here too. */
export type SignatureResult = { ok: true; photo: ProofPhoto } | { ok: false; reason: "EMPTY" | "FAILED" };

const PROOF_DIRECTORY = () => `${FileSystem.documentDirectory}proof/`;

/**
 * Opens the camera for the proof photo. The picture is copied from the camera's temporary cache into the app's document
 * folder, because a delivery completed offline keeps the photo until it reaches the server, possibly after a restart.
 * The camera is the only source (no gallery): the photo has to be taken at the door.
 */
export async function takeProofPhoto(): Promise<ProofResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: "PERMISSION_DENIED" };

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, allowsEditing: false, exif: false });
    if (result.canceled || !result.assets?.[0]) return { ok: false, reason: "CANCELLED" };

    await FileSystem.makeDirectoryAsync(PROOF_DIRECTORY(), { intermediates: true }).catch(() => undefined);
    const target = `${PROOF_DIRECTORY()}${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: result.assets[0].uri, to: target });
    return { ok: true, photo: { uri: target, capturedAt: new Date().toISOString() } };
  } catch {
    return { ok: false, reason: "FAILED" };
  }
}

/** Removes a photo that has reached the server (or was abandoned) so it does not sit on the phone. */
export async function discardProofPhoto(uri: string | undefined): Promise<void> {
  if (!uri) return;
  if (Platform.OS === "web") {
    if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
    return;
  }
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/**
 * Saves a signature drawn on screen - a `data:image/png;base64,...` URL from the signature pad - so an
 * offline-queued delivery keeps it until it reaches the server.
 *
 * Web has no real filesystem (expo-file-system's web shim is a stub: `documentDirectory` is literally
 * `null` - there is nothing under it to write to), so this turns the data URL into a real Blob and keeps it
 * as an in-memory object URL instead; deliveryApi.uploadProof knows to read a `blob:` URI back out with
 * `fetch()`. Native keeps using the app's document folder, the same way a photo does.
 */
export async function saveProofSignature(pngDataUrl: string): Promise<SignatureResult> {
  const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, "");
  if (!base64) return { ok: false, reason: "EMPTY" };

  if (Platform.OS === "web") {
    try {
      const blob = await (await fetch(pngDataUrl)).blob();
      return { ok: true, photo: { uri: URL.createObjectURL(blob), capturedAt: new Date().toISOString() } };
    } catch {
      return { ok: false, reason: "FAILED" };
    }
  }

  try {
    await FileSystem.makeDirectoryAsync(PROOF_DIRECTORY(), { intermediates: true }).catch(() => undefined);
    const target = `${PROOF_DIRECTORY()}${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { ok: true, photo: { uri: target, capturedAt: new Date().toISOString() } };
  } catch {
    return { ok: false, reason: "FAILED" };
  }
}
