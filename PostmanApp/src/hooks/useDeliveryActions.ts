import { useCallback } from "react";
import { useUpdateDeliveryStatus } from "./useDeliveries";
import { Delivery, DeliveryStatus } from "../types/delivery";
import { formatAddress } from "../utils/formatting";
import { openNavigation } from "../utils/navigation";
import { notify, confirmAction } from "../utils/alerts";
import { canTransition } from "../utils/status";
import { usePostmanProfile } from "./usePostmanProfile";
import { takeProofPhoto } from "../services/proofService";
import { getFreshFix } from "../services/lastFix";

export interface PrimaryAction {
  label: string;
  next: DeliveryStatus;
  /** Irreversible steps ask "are you sure?" first (DELIVERED is final). */
  confirm: boolean;
}

/**
 * The ONE next step the postman is expected to take from `status`. Only ever a
 * transition the backend's state machine allows — a parcel that is still
 * ASSIGNED must be started before it can be delivered, so it offers "Start
 * Delivery", never a shortcut to DELIVERED. (The server re-validates anyway.)
 */
export function primaryActionFor(status: DeliveryStatus): PrimaryAction | null {
  let action: PrimaryAction | null = null;
  if (status === "ASSIGNED" || status === "RESCHEDULED") {
    action = { label: "Start Delivery", next: "OUT_FOR_DELIVERY", confirm: false };
  } else if (status === "OUT_FOR_DELIVERY") {
    action = { label: "Mark Delivered", next: "DELIVERED", confirm: true };
  }
  return action && canTransition(status, action.next) ? action : null;
}

/** Whether "Navigate" makes sense: the parcel is still on the postman's round. */
export function canNavigateTo(status: DeliveryStatus): boolean {
  return status === "ASSIGNED" || status === "OUT_FOR_DELIVERY" || status === "RESCHEDULED";
}

interface Coordinates {
  latitude: number | null;
  longitude: number | null;
}

/**
 * Shared by the Deliveries card and the Map's selected-delivery sheet so both
 * behave identically: same button, same confirmation, same offline queueing,
 * same error messages. Status changes go through useUpdateDeliveryStatus →
 * POST /deliveries/:id/status (backend validates) and, when offline, the
 * existing offline queue — there is no second path.
 */
export function useDeliveryActions(delivery: Delivery, status: DeliveryStatus, coords: Coordinates) {
  const updateStatus = useUpdateDeliveryStatus();
  const profile = usePostmanProfile();
  const primary = primaryActionFor(status);
  // What the post office requires is the server's setting, read from the postman's own profile.
  const proofRequired = profile.data?.postOffice?.proofMode === "PHOTO";

  const run = useCallback(async () => {
    if (!primary) return;

    if (primary.confirm) {
      const ok = await confirmAction(
        "Mark as delivered?",
        `${delivery.recipient.name}\n${formatAddress(delivery.address)}`,
        primary.label
      );
      if (!ok) return;
    }

    // A required photo is taken BEFORE anything is sent, so "Delivered" is never recorded without it (the server refuses that too).
    let proof: { proofUri: string; proofCapturedAt: string } | undefined;
    if (primary.next === "DELIVERED" && proofRequired) {
      const taken = await takeProofPhoto();
      if (!taken.ok) {
        notify(
          "Photo needed",
          taken.reason === "PERMISSION_DENIED"
            ? "This post office requires a photo of the delivery. Allow camera access in Settings to complete it."
            : "This post office requires a photo of the delivery. Take the photo to complete it."
        );
        return;
      }
      proof = { proofUri: taken.photo.uri, proofCapturedAt: taken.photo.capturedAt };
    }

    // Where the postman IS when they act (never the address's own coordinates): the server uses it, when it is a good fix,
    // to learn where this address is.
    const fix = primary.next === "DELIVERED" ? getFreshFix() : null;
    const location = fix ? { latitude: fix.latitude, longitude: fix.longitude, ...(fix.accuracy != null ? { accuracyMeters: fix.accuracy } : {}) } : {};

    updateStatus.mutate(
      { deliveryId: delivery.id, status: primary.next, ...proof, ...location },
      {
        onSuccess: (result) => {
          if (result.queued) {
            notify("Saved offline", "This update will sync automatically when you're back online.");
          }
        },
        onError: (err) => {
          notify("Couldn't update status", err instanceof Error ? err.message : "Please try again.");
        }
      }
    );
  }, [primary, updateStatus, delivery, proofRequired]);

  const navigate = useCallback(async () => {
    const opened = await openNavigation({
      latitude: coords.latitude ?? delivery.address.latitude,
      longitude: coords.longitude ?? delivery.address.longitude,
      address: delivery.address,
      label: delivery.recipient.name
    });
    if (!opened) {
      notify("Couldn't open maps", "No maps app could be opened on this device.");
    }
  }, [coords.latitude, coords.longitude, delivery]);

  return { primary, run, navigate, isPending: updateStatus.isPending, canNavigate: canNavigateTo(status) };
}
