-- Notifications carry a title and a read time (the apps show both); the old boolean stays for compatibility.
ALTER TABLE "Notification" ADD COLUMN "title" TEXT;
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);
UPDATE "Notification" SET "readAt" = "createdAt" WHERE "isRead" = true;
