import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";

export interface ProofPhoto {
  /** A file inside the app's own storage: it survives the app being closed while the phone is offline. */
  uri: string;
  capturedAt: string;
}

export type ProofResult = { ok: true; photo: ProofPhoto } | { ok: false; reason: "PERMISSION_DENIED" | "CANCELLED" | "FAILED" };

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
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}
