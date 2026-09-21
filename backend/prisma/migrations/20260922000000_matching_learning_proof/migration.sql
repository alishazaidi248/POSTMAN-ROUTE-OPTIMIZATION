-- Address -> beat matching, geocoding precision, address learning, beat directory (localities per beat),
-- proof of delivery, weight, forced first-login password change and push tokens.
-- ADDITIVE ONLY: no table is dropped, no row is deleted; existing rows keep working (new columns are nullable or defaulted).

CREATE TYPE "GeocodingPrecision" AS ENUM ('HOUSE', 'STREET', 'AREA', 'PINCODE', 'NONE');
CREATE TYPE "AssignmentMethod" AS ENUM ('NAME', 'NAME_AND_TERRITORY', 'TERRITORY', 'MANUAL');
CREATE TYPE "ProofMode" AS ENUM ('NONE', 'PHOTO');

ALTER TYPE "ExceptionReason" ADD VALUE IF NOT EXISTS 'AMBIGUOUS_MATCH';
ALTER TYPE "ExceptionReason" ADD VALUE IF NOT EXISTS 'LOW_CONFIDENCE_MATCH';
ALTER TYPE "ExceptionReason" ADD VALUE IF NOT EXISTS 'WEAK_LOCATION';

-- How precise a geocode is, and the normalised address it belongs to (the key of address learning).
ALTER TABLE "Address"
  ADD COLUMN "geocodingPrecision" "GeocodingPrecision",
  ADD COLUMN "geocodingMeta" JSONB,
  ADD COLUMN "normalizedKey" TEXT;
CREATE INDEX "Address_normalizedKey_idx" ON "Address"("normalizedKey");

-- Existing rows: derive the precision from what the geocoder recorded (its fallback tier).
UPDATE "Address" SET "geocodingPrecision" = CASE
  WHEN "geocodingStatus" = 'MANUAL' THEN 'HOUSE'::"GeocodingPrecision"
  WHEN "geocodingStatus" <> 'SUCCESS' THEN 'NONE'::"GeocodingPrecision"
  WHEN "geocodingSource" = 'nominatim-pincode' THEN 'PINCODE'::"GeocodingPrecision"
  WHEN "geocodingSource" = 'nominatim-area' THEN 'AREA'::"GeocodingPrecision"
  ELSE 'STREET'::"GeocodingPrecision" END
WHERE "geocodingPrecision" IS NULL;

-- Why a delivery is where it is: the method, a 0-100 confidence and the evidence behind it.
ALTER TABLE "Delivery"
  ADD COLUMN "assignmentMethod" "AssignmentMethod",
  ADD COLUMN "assignmentConfidence" INTEGER,
  ADD COLUMN "assignmentEvidence" JSONB,
  ADD COLUMN "weightKg" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_weight_positive" CHECK ("weightKg" IS NULL OR "weightKg" > 0);
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_assignment_confidence_range" CHECK ("assignmentConfidence" IS NULL OR ("assignmentConfidence" BETWEEN 0 AND 100));

-- An exception now carries the system's best suggestion and how sure it is.
ALTER TABLE "AssignmentException"
  ADD COLUMN "suggestedBeatId" TEXT,
  ADD COLUMN "confidence" INTEGER,
  ADD COLUMN "locationQuality" "GeocodingPrecision",
  ADD COLUMN "evidence" JSONB;
ALTER TABLE "AssignmentException" ADD CONSTRAINT "AssignmentException_suggestedBeatId_fkey"
  FOREIGN KEY ("suggestedBeatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The beat directory: which localities (and main areas) belong to which beat. Many rows per beat.
CREATE TABLE "BeatLocality" (
  "id" TEXT NOT NULL,
  "beatId" TEXT NOT NULL,
  "postOfficeId" TEXT NOT NULL,
  "locality" TEXT NOT NULL,
  "mainArea" TEXT,
  "pincode" TEXT,
  "normalizedLocality" TEXT NOT NULL,
  "normalizedMainArea" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'IMPORT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BeatLocality_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BeatLocality_beat_locality_area_key" ON "BeatLocality"("beatId", "normalizedLocality", "normalizedMainArea");
CREATE INDEX "BeatLocality_postOfficeId_idx" ON "BeatLocality"("postOfficeId");
CREATE INDEX "BeatLocality_normalizedLocality_idx" ON "BeatLocality"("normalizedLocality");
ALTER TABLE "BeatLocality" ADD CONSTRAINT "BeatLocality_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeatLocality" ADD CONSTRAINT "BeatLocality_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Address learning: where deliveries to an address were actually completed.
CREATE TABLE "AddressLocation" (
  "id" TEXT NOT NULL,
  "postOfficeId" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 1,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "beatId" TEXT,
  "lastDeliveredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AddressLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AddressLocation_office_key_key" ON "AddressLocation"("postOfficeId", "normalizedKey");
ALTER TABLE "AddressLocation" ADD CONSTRAINT "AddressLocation_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AddressLocation" ADD CONSTRAINT "AddressLocation_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AddressLocationSample" (
  "id" TEXT NOT NULL,
  "addressLocationId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyMeters" DOUBLE PRECISION,
  "accepted" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AddressLocationSample_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AddressLocationSample_delivery_key" ON "AddressLocationSample"("deliveryId");
CREATE INDEX "AddressLocationSample_location_idx" ON "AddressLocationSample"("addressLocationId");
ALTER TABLE "AddressLocationSample" ADD CONSTRAINT "AddressLocationSample_addressLocationId_fkey" FOREIGN KEY ("addressLocationId") REFERENCES "AddressLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AddressLocationSample" ADD CONSTRAINT "AddressLocationSample_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Proof of delivery. Whether it is required is a per-post-office setting.
ALTER TABLE "PostOffice" ADD COLUMN "proofMode" "ProofMode" NOT NULL DEFAULT 'NONE';
CREATE TABLE "DeliveryProof" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'PHOTO',
  "storageKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "capturedById" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryProof_deliveryId_key" ON "DeliveryProof"("deliveryId");
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- First login: an administrator-created account must choose its own password before it can use the API.
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- Push notification device tokens (Expo push service).
CREATE TABLE "PushToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
