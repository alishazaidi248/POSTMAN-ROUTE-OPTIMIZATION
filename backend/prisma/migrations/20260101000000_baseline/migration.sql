-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'POSTMAN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BeatStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PostmanStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_USE', 'CHARGING', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ParcelPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('RECEIVED', 'SORTED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RECIPIENT_UNAVAILABLE', 'REJECTED', 'WRONG_ADDRESS', 'ADDRESS_NOT_FOUND', 'RESCHEDULED', 'RETURNED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GeocodingStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportFileType" AS ENUM ('CSV', 'XLSX', 'XLS', 'PDF', 'JSON');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PREVIEW_READY', 'CONFIRMED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'MISSING_DATA', 'GEOCODING_PENDING', 'GEOCODING_FAILED', 'NEEDS_REVIEW', 'IMPORTED');

-- CreateEnum
CREATE TYPE "ExceptionReason" AS ENUM ('GEOCODING_FAILED', 'NO_BEAT_MATCH', 'MULTIPLE_BEAT_MATCH', 'INVALID_ADDRESS', 'INVALID_COORDINATES', 'NO_POSTMAN_ASSIGNED', 'INACTIVE_POSTMAN', 'OUTSIDE_POST_OFFICE');

-- CreateEnum
CREATE TYPE "ExceptionAction" AS ENUM ('VIEWED', 'ADDRESS_CORRECTED', 'GEOCODING_RETRIED', 'MANUALLY_ASSIGNED', 'BEAT_CHANGED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "PostOffice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostOffice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "postOfficeId" TEXT,
    "postmanId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beat" (
    "id" TEXT NOT NULL,
    "postOfficeId" TEXT NOT NULL,
    "beat_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boundary" geometry(Polygon,4326),
    "centerLatitude" DOUBLE PRECISION NOT NULL,
    "centerLongitude" DOUBLE PRECISION NOT NULL,
    "status" "BeatStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postman" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postOfficeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "emergencyContact" TEXT,
    "joiningDate" TIMESTAMP(3),
    "status" "PostmanStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedBeatId" TEXT,
    "profilePhotoUrl" TEXT,
    "currentLocation" geography(Point,4326),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Postman_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostmanBeatAssignment" (
    "id" TEXT NOT NULL,
    "postmanId" TEXT NOT NULL,
    "beatId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PostmanBeatAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "postOfficeId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "batteryCapacityWh" INTEGER NOT NULL,
    "currentBatteryPercentage" INTEGER NOT NULL DEFAULT 100,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assignedPostmanId" TEXT,
    "lastMaintenanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleBatteryLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "batteryPercentage" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleBatteryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "altPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "area" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location" geography(Point,4326),
    "geocodingStatus" "GeocodingStatus" NOT NULL DEFAULT 'PENDING',
    "geocodingSource" TEXT,
    "geocodingConfidence" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "trackingId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "parcelType" TEXT,
    "parcelCount" INTEGER NOT NULL DEFAULT 1,
    "priority" "ParcelPriority" NOT NULL DEFAULT 'NORMAL',
    "urgency" TEXT,
    "serviceTimeMinutes" INTEGER,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'RECEIVED',
    "postOfficeId" TEXT NOT NULL,
    "beatId" TEXT,
    "assignedPostmanId" TEXT,
    "importRowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryStatusHistory" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus" NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "postmanId" TEXT,
    "outcome" "DeliveryStatus" NOT NULL,
    "notes" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAssignmentHistory" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "beatId" TEXT,
    "postmanId" TEXT,
    "reason" TEXT,
    "changedBy" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentException" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "reason" "ExceptionReason" NOT NULL,
    "details" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "lastAction" "ExceptionAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryImport" (
    "id" TEXT NOT NULL,
    "postOfficeId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "fileType" "ImportFileType" NOT NULL,
    "columnMapping" JSONB,
    "sheetName" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "missingDataRows" INTEGER NOT NULL DEFAULT 0,
    "geocodingFailedRows" INTEGER NOT NULL DEFAULT 0,
    "assignmentFailedRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "status" "ImportRowStatus" NOT NULL,
    "errors" JSONB,
    "ocrConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostmanLocationHistory" (
    "id" TEXT NOT NULL,
    "postmanId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "batteryPct" INTEGER,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostmanLocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "postmanId" TEXT NOT NULL,
    "planDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "plannedGeoJson" JSONB,
    "actualGeoJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteEvent" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationRequest" (
    "id" TEXT NOT NULL,
    "postOfficeId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "parameters" JSONB,
    "status" "OptimizationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationResult" (
    "id" TEXT NOT NULL,
    "optimizationRequestId" TEXT NOT NULL,
    "resultData" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostOffice_code_key" ON "PostOffice"("code");

-- CreateIndex
CREATE INDEX "PostOffice_pincode_idx" ON "PostOffice"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_postmanId_key" ON "User"("postmanId");

-- CreateIndex
CREATE INDEX "User_postOfficeId_idx" ON "User"("postOfficeId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Beat_postOfficeId_idx" ON "Beat"("postOfficeId");

-- CreateIndex
CREATE UNIQUE INDEX "Beat_postOfficeId_beat_number_key" ON "Beat"("postOfficeId", "beat_number");

-- CreateIndex
CREATE UNIQUE INDEX "Postman_employeeId_key" ON "Postman"("employeeId");

-- CreateIndex
CREATE INDEX "Postman_postOfficeId_idx" ON "Postman"("postOfficeId");

-- CreateIndex
CREATE INDEX "Postman_assignedBeatId_idx" ON "Postman"("assignedBeatId");

-- CreateIndex
CREATE INDEX "PostmanBeatAssignment_postmanId_idx" ON "PostmanBeatAssignment"("postmanId");

-- CreateIndex
CREATE INDEX "PostmanBeatAssignment_beatId_idx" ON "PostmanBeatAssignment"("beatId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_assetId_key" ON "Vehicle"("assetId");

-- CreateIndex
CREATE INDEX "Vehicle_postOfficeId_idx" ON "Vehicle"("postOfficeId");

-- CreateIndex
CREATE INDEX "VehicleBatteryLog_vehicleId_recordedAt_idx" ON "VehicleBatteryLog"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "Recipient_phone_idx" ON "Recipient"("phone");

-- CreateIndex
CREATE INDEX "Address_pincode_idx" ON "Address"("pincode");

-- CreateIndex
CREATE INDEX "Address_recipientId_idx" ON "Address"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_trackingId_key" ON "Delivery"("trackingId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_importRowId_key" ON "Delivery"("importRowId");

-- CreateIndex
CREATE INDEX "Delivery_postOfficeId_idx" ON "Delivery"("postOfficeId");

-- CreateIndex
CREATE INDEX "Delivery_beatId_idx" ON "Delivery"("beatId");

-- CreateIndex
CREATE INDEX "Delivery_assignedPostmanId_idx" ON "Delivery"("assignedPostmanId");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "DeliveryStatusHistory_deliveryId_idx" ON "DeliveryStatusHistory"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_deliveryId_idx" ON "DeliveryAttempt"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliveryAssignmentHistory_deliveryId_idx" ON "DeliveryAssignmentHistory"("deliveryId");

-- CreateIndex
CREATE INDEX "AssignmentException_deliveryId_idx" ON "AssignmentException"("deliveryId");

-- CreateIndex
CREATE INDEX "AssignmentException_reason_idx" ON "AssignmentException"("reason");

-- CreateIndex
CREATE INDEX "DeliveryImport_postOfficeId_idx" ON "DeliveryImport"("postOfficeId");

-- CreateIndex
CREATE INDEX "DeliveryImportRow_importId_idx" ON "DeliveryImportRow"("importId");

-- CreateIndex
CREATE INDEX "DeliveryImportRow_status_idx" ON "DeliveryImportRow"("status");

-- CreateIndex
CREATE INDEX "PostmanLocationHistory_postmanId_recordedAt_idx" ON "PostmanLocationHistory"("postmanId", "recordedAt");

-- CreateIndex
CREATE INDEX "Route_postmanId_planDate_idx" ON "Route"("postmanId", "planDate");

-- CreateIndex
CREATE INDEX "RouteStop_routeId_idx" ON "RouteStop"("routeId");

-- CreateIndex
CREATE INDEX "RouteEvent_routeId_idx" ON "RouteEvent"("routeId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "OptimizationRequest_postOfficeId_idx" ON "OptimizationRequest"("postOfficeId");

-- CreateIndex
CREATE INDEX "OptimizationResult_optimizationRequestId_idx" ON "OptimizationResult"("optimizationRequestId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postman" ADD CONSTRAINT "Postman_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postman" ADD CONSTRAINT "Postman_assignedBeatId_fkey" FOREIGN KEY ("assignedBeatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostmanBeatAssignment" ADD CONSTRAINT "PostmanBeatAssignment_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostmanBeatAssignment" ADD CONSTRAINT "PostmanBeatAssignment_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_assignedPostmanId_fkey" FOREIGN KEY ("assignedPostmanId") REFERENCES "Postman"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBatteryLog" ADD CONSTRAINT "VehicleBatteryLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_assignedPostmanId_fkey" FOREIGN KEY ("assignedPostmanId") REFERENCES "Postman"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "DeliveryImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusHistory" ADD CONSTRAINT "DeliveryStatusHistory_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAssignmentHistory" ADD CONSTRAINT "DeliveryAssignmentHistory_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAssignmentHistory" ADD CONSTRAINT "DeliveryAssignmentHistory_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAssignmentHistory" ADD CONSTRAINT "DeliveryAssignmentHistory_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentException" ADD CONSTRAINT "AssignmentException_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryImport" ADD CONSTRAINT "DeliveryImport_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryImport" ADD CONSTRAINT "DeliveryImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryImportRow" ADD CONSTRAINT "DeliveryImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DeliveryImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostmanLocationHistory" ADD CONSTRAINT "PostmanLocationHistory_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_postmanId_fkey" FOREIGN KEY ("postmanId") REFERENCES "Postman"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEvent" ADD CONSTRAINT "RouteEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationRequest" ADD CONSTRAINT "OptimizationRequest_postOfficeId_fkey" FOREIGN KEY ("postOfficeId") REFERENCES "PostOffice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationResult" ADD CONSTRAINT "OptimizationResult_optimizationRequestId_fkey" FOREIGN KEY ("optimizationRequestId") REFERENCES "OptimizationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

