import { GeocodingPrecision } from "@prisma/client";
import { GeocodeComponents } from "./GeocodingService";

/**
 * How precisely a provider's match identifies the address, from what the provider says the match IS (not from how
 * confident it sounds). Pure functions, unit-tested; the providers only feed them their raw fields.
 *
 * The query tier matters as much as the match: a provider that could not find the house and was asked again with only
 * "<area>, <city>" returns the centre of the area, and that is AREA precision whatever the match itself is called.
 */
export type QueryTier = "full" | "area" | "pincode";

const NOMINATIM_HOUSE = new Set(["house", "building", "apartments", "residential", "commercial", "industrial", "retail", "office", "school", "hospital", "place_of_worship", "yes", "detached", "terrace", "dormitory"]);
const NOMINATIM_STREET = new Set(["road", "street", "residential_road", "path", "pedestrian", "footway", "track", "service", "tertiary", "secondary", "primary", "trunk", "unclassified", "living_street", "highway"]);

export interface NominatimMatch {
  class?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
}

export function nominatimPrecision(match: NominatimMatch, tier: QueryTier): GeocodingPrecision {
  if (tier === "pincode") return "PINCODE";
  if (tier === "area") return "AREA";
  const kind = (match.addresstype ?? match.type ?? "").toLowerCase();
  if (kind === "postcode" || match.type === "postcode") return "PINCODE";
  if (match.address?.house_number || match.address?.building) return "HOUSE";
  if (NOMINATIM_HOUSE.has(kind) && match.class === "building") return "HOUSE";
  if (NOMINATIM_HOUSE.has(kind) && kind !== "yes" && kind !== "residential") return "HOUSE";
  if (match.class === "highway" || NOMINATIM_STREET.has(kind)) return "STREET";
  return "AREA"; // suburb, neighbourhood, quarter, city_district, village, city...: the middle of a place
}

export function nominatimComponents(match: NominatimMatch): GeocodeComponents {
  const a = match.address ?? {};
  return {
    houseNumber: a.house_number,
    building: a.building,
    road: a.road,
    locality: a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.village,
    city: a.city ?? a.town ?? a.state_district,
    state: a.state,
    pincode: a.postcode
  };
}

export interface GoogleMatch {
  types?: string[];
  geometry?: { location_type?: string };
  address_components?: { long_name: string; types: string[] }[];
}

export function googlePrecision(match: GoogleMatch, tier: QueryTier): GeocodingPrecision {
  if (tier === "pincode") return "PINCODE";
  if (tier === "area") return "AREA";
  const types = match.types ?? [];
  const locationType = match.geometry?.location_type ?? "APPROXIMATE";
  if (types.includes("postal_code")) return "PINCODE";
  const isPoint = types.some((t) => ["street_address", "premise", "subpremise", "establishment", "point_of_interest"].includes(t));
  if (locationType === "ROOFTOP" && isPoint) return "HOUSE";
  if (locationType === "ROOFTOP" || locationType === "RANGE_INTERPOLATED") return types.includes("route") ? "STREET" : isPoint ? "STREET" : "AREA";
  if (types.includes("route")) return "STREET";
  return "AREA"; // GEOMETRIC_CENTER / APPROXIMATE of a locality, sublocality, neighbourhood...
}

export function googleComponents(match: GoogleMatch): GeocodeComponents {
  const find = (t: string) => match.address_components?.find((c) => c.types.includes(t))?.long_name;
  return {
    houseNumber: find("street_number"),
    building: find("premise"),
    road: find("route"),
    locality: find("sublocality_level_1") ?? find("sublocality") ?? find("neighborhood"),
    city: find("locality"),
    state: find("administrative_area_level_1"),
    pincode: find("postal_code")
  };
}

/** The precision a stored geocode gets when only the legacy `source` tag is known (used by the migration's backfill too). */
export function precisionFromSource(source: string | null | undefined, status: string): GeocodingPrecision {
  if (source === "manual") return "HOUSE";
  if (status !== "SUCCESS" && status !== "MANUAL") return "NONE";
  if (source?.endsWith("-pincode")) return "PINCODE";
  if (source?.endsWith("-area")) return "AREA";
  return "STREET";
}
