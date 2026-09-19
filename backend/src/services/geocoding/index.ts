import { GeocodingService } from "./GeocodingService";
import { NominatimGeocodingService } from "./NominatimGeocodingService";
import { GoogleGeocodingService } from "./GoogleGeocodingService";
import { env } from "../../config/env";

let instance: GeocodingService | null = null;

export function getGeocodingService(): GeocodingService {
  if (!instance) {
    switch (env.geocodingProvider) {
      case "google":
        instance = new GoogleGeocodingService();
        break;
      case "nominatim":
      default:
        instance = new NominatimGeocodingService();
    }
  }
  return instance;
}

export * from "./GeocodingService";
