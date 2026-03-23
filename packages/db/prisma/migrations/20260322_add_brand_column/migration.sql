-- Add brand JSON column to OrganizationSettings
ALTER TABLE "OrganizationSettings" ADD COLUMN "brand" JSONB NOT NULL DEFAULT '{}';
