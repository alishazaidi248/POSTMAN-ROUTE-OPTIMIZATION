-- Beat verification + beat-list import. Additive: no existing row is deleted or rewritten
-- except that beats which already have a drawn territory are marked VERIFIED (an
-- administrator drew them on the map), and beats without one are marked NEEDS_REVIEW.

CREATE TYPE "BeatVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'NEEDS_REVIEW');

ALTER TABLE "Beat"
  ADD COLUMN "verificationStatus" "BeatVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT;

-- A beat listed in a beat list may not have a territory (or a centre point) yet.
ALTER TABLE "Beat" ALTER COLUMN "centerLatitude" DROP NOT NULL;
ALTER TABLE "Beat" ALTER COLUMN "centerLongitude" DROP NOT NULL;

UPDATE "Beat" SET "verificationStatus" = 'VERIFIED', "verifiedAt" = "createdAt" WHERE boundary IS NOT NULL;
UPDATE "Beat" SET "verificationStatus" = 'NEEDS_REVIEW' WHERE boundary IS NULL;

ALTER TABLE "Beat" ADD CONSTRAINT "Beat_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A beat can only be VERIFIED if it has a territory.
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_verified_needs_territory"
  CHECK ("verificationStatus" <> 'VERIFIED' OR boundary IS NOT NULL);

-- An uploaded beat list, held (parsed, not yet imported) until the administrator confirms it.
CREATE TABLE "BeatImport" (
  "id" TEXT NOT NULL,
  "postOfficeId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sheetName" TEXT,
  "columns" JSONB NOT NULL,
  "rawRows" JSONB NOT NULL,
  "columnMapping" JSONB NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW_READY',
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "BeatImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BeatImport_postOfficeId_idx" ON "BeatImport"("postOfficeId");

ALTER TABLE "BeatImport" ADD CONSTRAINT "BeatImport_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BeatImport" ADD CONSTRAINT "BeatImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
