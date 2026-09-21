import { FAILED_RESULT, GeocodeResult, GeocodingService } from "./GeocodingService";

/**
 * GEOCODING_PROVIDER=none: no external geocoder is called (offline installations, automated tests, a provider outage).
 * Every address is "not located", so a delivery is assigned by the beat list alone (which needs no coordinates) or goes to an
 * assignment exception, and an administrator can place it by hand.
 */
export class NoGeocodingService implements GeocodingService {
  async geocode(): Promise<GeocodeResult> {
    return FAILED_RESULT("disabled");
  }
}
