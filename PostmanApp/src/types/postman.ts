export type PostmanStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE";

export interface Beat {
  id: string;
  beatNumber: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  status: "ACTIVE" | "INACTIVE";
}

export interface Postman {
  id: string;
  employeeId: string;
  postOfficeId: string;
  name: string;
  phone: string;
  email: string | null;
  status: PostmanStatus;
  assignedBeatId: string | null;
  profilePhotoUrl: string | null;
  lastActiveAt: string | null;
}

export interface PostmanProfileResponse {
  postman: Postman;
  beat: Beat | null;
  lastKnownLocation: {
    latitude: number;
    longitude: number;
    recordedAt: string;
    batteryPct: number | null;
  } | null;
}
