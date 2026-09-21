export interface NormalizedRow {
  recipientName: string;
  phone: string;
  altPhone?: string;
  addressLine1: string;
  addressLine2?: string;
  area?: string;
  city: string;
  state: string;
  pincode: string;
  trackingId: string;
  parcelType?: string;
  priority?: string;
  serviceTime?: number;
  /** Real weight in kilograms; empty when the file has none. */
  weightKg?: number;
}

const PHONE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^\d{6}$/;

export interface RowValidationResult {
  status: "VALID" | "INVALID" | "MISSING_DATA";
  errors: string[];
  normalized: Partial<NormalizedRow>;
}

function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

export function normalizeAndValidateRow(
  raw: Record<string, string>,
  mapping: Record<string, string | null>
): RowValidationResult {
  const errors: string[] = [];
  const get = (field: string) => {
    const col = mapping[field];
    return col ? (raw[col] ?? "").toString().trim() : "";
  };

  const recipientName = get("recipientName");
  const phone = cleanPhone(get("phone"));
  const addressLine1 = get("addressLine1");
  const city = get("city");
  const state = get("state");
  const pincode = get("pincode").replace(/\D/g, "");
  const trackingId = get("trackingId") || `AUTO-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  if (!recipientName) errors.push("Missing recipient name");
  if (!addressLine1) errors.push("Missing address");
  if (!city) errors.push("Missing city");
  if (!state) errors.push("Missing state");

  if (!phone) {
    errors.push("Missing phone number");
  } else if (!PHONE_RE.test(phone)) {
    errors.push(`Invalid phone number: ${phone}`);
  }

  if (!pincode) {
    errors.push("Missing pincode");
  } else if (!PINCODE_RE.test(pincode)) {
    errors.push(`Invalid pincode: ${pincode}`);
  }

  // A weight is a positive number of kilograms (a parcel count is not a weight, and is not accepted here).
  const weightText = get("weightKg").replace(/,/g, ".");
  let weightKg: number | undefined;
  if (weightText) {
    const w = Number(weightText.replace(/\s*kgs?\.?$/i, ""));
    if (!Number.isFinite(w) || w <= 0 || w > 1000) errors.push(`Invalid weight: ${weightText} (kilograms, above 0 and at most 1000)`);
    else weightKg = Math.round(w * 1000) / 1000;
  }

  const normalized: Partial<NormalizedRow> = {
    recipientName,
    phone,
    altPhone: cleanPhone(get("altPhone")) || undefined,
    addressLine1,
    addressLine2: get("addressLine2") || undefined,
    area: get("area") || undefined,
    city,
    state,
    pincode,
    trackingId,
    parcelType: get("parcelType") || undefined,
    priority: get("priority") || undefined,
    serviceTime: get("serviceTime") ? Number(get("serviceTime")) || undefined : undefined,
    weightKg
  };

  if (errors.length === 0) return { status: "VALID", errors, normalized };

  const missingOnly = errors.every((e) => e.startsWith("Missing"));
  return { status: missingOnly ? "MISSING_DATA" : "INVALID", errors, normalized };
}
