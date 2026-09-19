export const SYSTEM_FIELDS = [
  "recipientName",
  "phone",
  "altPhone",
  "addressLine1",
  "addressLine2",
  "area",
  "city",
  "state",
  "pincode",
  "trackingId",
  "parcelType",
  "priority",
  "serviceTime"
] as const;

export type SystemField = (typeof SYSTEM_FIELDS)[number];

/** Known header aliases (spec §8) used to pre-fill the mapping UI. Admin can override any of it. */
const ALIASES: Record<SystemField, string[]> = {
  recipientName: ["name", "recipient_name", "customer_name", "recipient", "consignee"],
  phone: ["phone", "mobile", "contact", "phone_number", "mobile_number"],
  altPhone: ["alternate_phone", "alt_phone", "secondary_phone"],
  addressLine1: ["address", "address_line_1", "address1", "full_address"],
  addressLine2: ["address_line_2", "address2", "landmark"],
  area: ["area", "locality", "neighborhood"],
  city: ["city", "town"],
  state: ["state"],
  pincode: ["pincode", "pin", "zip", "postal_code"],
  trackingId: ["tracking_id", "parcel_id", "awb", "awb_number", "consignment_no"],
  parcelType: ["parcel_type", "item_type"],
  priority: ["priority", "urgency"],
  serviceTime: ["service_time", "service_time_minutes"]
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function suggestColumnMapping(detectedColumns: string[]): Record<SystemField, string | null> {
  const mapping = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f, null])) as Record<SystemField, string | null>;
  const normalizedColumns = detectedColumns.map((c) => ({ raw: c, normalized: normalizeHeader(c) }));

  for (const field of SYSTEM_FIELDS) {
    const aliases = ALIASES[field];
    const match = normalizedColumns.find((c) => aliases.includes(c.normalized));
    if (match) mapping[field] = match.raw;
  }

  return mapping;
}
