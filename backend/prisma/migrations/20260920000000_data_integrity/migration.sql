-- Data-integrity guarantees enforced by PostgreSQL itself, so they hold no matter
-- which client (or bug) writes. Additive only: no table, column or row is changed.

-- Beat matching is `ST_Contains(boundary, point)`; a GiST index makes it a spatial
-- lookup instead of a scan over every beat polygon.
CREATE INDEX IF NOT EXISTS "Beat_boundary_gix" ON "Beat" USING GIST ("boundary");

-- A beat has at most ONE active postman, and a postman covers at most ONE active
-- beat. The application already maintains this (assignment.service.ts); these
-- partial unique indexes make it impossible to violate.
CREATE UNIQUE INDEX IF NOT EXISTS "PostmanBeatAssignment_one_active_per_beat"
  ON "PostmanBeatAssignment" ("beatId") WHERE "isActive";
CREATE UNIQUE INDEX IF NOT EXISTS "PostmanBeatAssignment_one_active_per_postman"
  ON "PostmanBeatAssignment" ("postmanId") WHERE "isActive";

-- A polygon must be a valid, non-empty geometry.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Beat_boundary_valid') THEN
    ALTER TABLE "Beat" ADD CONSTRAINT "Beat_boundary_valid"
      CHECK ("boundary" IS NULL OR (ST_IsValid("boundary") AND NOT ST_IsEmpty("boundary")));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Address_coordinates_range') THEN
    ALTER TABLE "Address" ADD CONSTRAINT "Address_coordinates_range"
      CHECK (("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));
  END IF;
END $$;
