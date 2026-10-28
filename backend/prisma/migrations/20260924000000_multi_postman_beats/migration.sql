-- A beat may now have more than one active postman at once; its open deliveries then split between them
-- (see assignment.service.ts: divideBeatDeliveries / syncBeatDeliveries). A postman still covers at most
-- one active beat, so PostmanBeatAssignment_one_active_per_postman stays.
DROP INDEX IF EXISTS "PostmanBeatAssignment_one_active_per_beat";
