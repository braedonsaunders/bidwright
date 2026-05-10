-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "general" JSONB NOT NULL DEFAULT '{}',
    "email" JSONB NOT NULL DEFAULT '{}',
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "integrations" JSONB NOT NULL DEFAULT '{}',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "maxUsers" INTEGER NOT NULL DEFAULT 0,
    "maxProjects" INTEGER NOT NULL DEFAULT 0,
    "maxStorage" INTEGER NOT NULL DEFAULT 0,
    "maxKnowledgeBooks" INTEGER NOT NULL DEFAULT 0,
    "termsAndConditions" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimatorPersona" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT 'mechanical',
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "knowledgeBookIds" JSONB NOT NULL DEFAULT '[]',
    "knowledgeDocumentIds" JSONB NOT NULL DEFAULT '[]',
    "datasetTags" JSONB NOT NULL DEFAULT '[]',
    "packageBuckets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultAssumptions" JSONB NOT NULL DEFAULT '{}',
    "productivityGuidance" JSONB NOT NULL DEFAULT '{}',
    "commercialGuidance" JSONB NOT NULL DEFAULT '{}',
    "reviewFocusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimatorPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'estimator',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrations" JSONB NOT NULL DEFAULT '{}',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT,
    "superAdminId" TEXT,
    "organizationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ipAddress" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "packageName" TEXT NOT NULL DEFAULT '',
    "packageUploadedAt" TEXT NOT NULL DEFAULT '',
    "ingestionStatus" TEXT NOT NULL DEFAULT 'queued',
    "scope" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "isStandalone" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT 'reference',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL DEFAULT '',
    "extractedText" TEXT NOT NULL DEFAULT '',
    "structuredData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentRevisionId" TEXT NOT NULL DEFAULT '',
    "customerExistingNew" TEXT NOT NULL DEFAULT 'New',
    "customerId" TEXT,
    "customerString" TEXT NOT NULL DEFAULT '',
    "customerContactId" TEXT,
    "customerContactString" TEXT NOT NULL DEFAULT '',
    "customerContactEmailString" TEXT NOT NULL DEFAULT '',
    "departmentId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRevision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "breakoutStyle" TEXT NOT NULL DEFAULT 'grand_total',
    "type" TEXT NOT NULL DEFAULT 'Firm',
    "scratchpad" TEXT NOT NULL DEFAULT '',
    "leadLetter" TEXT NOT NULL DEFAULT '',
    "dateEstimatedShip" TEXT,
    "dateQuote" TEXT,
    "dateDue" TEXT,
    "dateWalkdown" TEXT,
    "dateWorkStart" TEXT,
    "dateWorkEnd" TEXT,
    "shippingMethod" TEXT NOT NULL DEFAULT '',
    "shippingTerms" TEXT NOT NULL DEFAULT '',
    "freightOnBoard" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "defaultMarkup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "followUpNote" TEXT NOT NULL DEFAULT '',
    "printEmptyNotesColumn" BOOLEAN NOT NULL DEFAULT false,
    "printCategory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "printPhaseTotalOnly" BOOLEAN NOT NULL DEFAULT false,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "regHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "doubleHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakoutPackage" JSONB NOT NULL DEFAULT '[]',
    "calculatedCategoryTotals" JSONB NOT NULL DEFAULT '[]',
    "pricingLadder" JSONB NOT NULL DEFAULT '{}',
    "summaryLayoutPreset" TEXT NOT NULL DEFAULT 'custom',
    "pdfPreferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetFolder" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Folder',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorksheetFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Worksheet 1',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Worksheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetItem" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "phaseId" TEXT,
    "categoryId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Material',
    "entityType" TEXT NOT NULL DEFAULT 'Material',
    "entityName" TEXT NOT NULL DEFAULT '',
    "classification" JSONB NOT NULL DEFAULT '{}',
    "costCode" TEXT,
    "vendor" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "markup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineOrder" INTEGER NOT NULL DEFAULT 0,
    "rateScheduleItemId" TEXT,
    "itemId" TEXT,
    "tierUnits" JSONB NOT NULL DEFAULT '{}',
    "costSnapshot" JSONB NOT NULL DEFAULT '{}',
    "rateResolution" JSONB NOT NULL DEFAULT '{}',
    "sourceNotes" TEXT NOT NULL DEFAULT '',
    "costResourceId" TEXT,
    "effectiveCostId" TEXT,
    "laborUnitId" TEXT,
    "resourceComposition" JSONB NOT NULL DEFAULT '{}',
    "sourceEvidence" JSONB NOT NULL DEFAULT '{}',
    "sourceAssemblyId" TEXT,
    "assemblyInstanceId" TEXT,

    CONSTRAINT "WorksheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "parentId" TEXT,
    "number" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "startDate" TEXT,
    "endDate" TEXT,
    "color" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "phaseId" TEXT,
    "calendarId" TEXT,
    "parentTaskId" TEXT,
    "outlineLevel" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "taskType" TEXT NOT NULL DEFAULT 'task',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "startDate" TEXT,
    "endDate" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assignee" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "constraintType" TEXT NOT NULL DEFAULT 'asap',
    "constraintDate" TEXT,
    "deadlineDate" TEXT,
    "actualStart" TEXT,
    "actualEnd" TEXT,
    "baselineStart" TEXT,
    "baselineEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDependency" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduleDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleCalendar" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "workingDays" JSONB NOT NULL DEFAULT '{}',
    "shiftStartMinutes" INTEGER NOT NULL DEFAULT 480,
    "shiftEndMinutes" INTEGER NOT NULL DEFAULT 1020,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBaseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBaselineTask" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL DEFAULT '',
    "phaseId" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleBaselineTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "calendarId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'labor',
    "color" TEXT NOT NULL DEFAULT '',
    "defaultUnits" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "capacityPerDay" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "costRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "role" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "appliesTo" TEXT NOT NULL DEFAULT 'All',
    "percentage" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "show" TEXT NOT NULL DEFAULT 'Yes',

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalLineItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'LineItemAdditional',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AdditionalLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'modifier',
    "pricingMode" TEXT NOT NULL DEFAULT 'modifier',
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "financialCategory" TEXT NOT NULL DEFAULT 'other',
    "calculationBase" TEXT NOT NULL DEFAULT 'selected_scope',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT NOT NULL DEFAULT 'All',
    "percentage" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "show" TEXT NOT NULL DEFAULT 'Yes',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateFactor" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'Productivity',
    "impact" TEXT NOT NULL DEFAULT 'labor_hours',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT NOT NULL DEFAULT 'Labour',
    "applicationScope" TEXT NOT NULL DEFAULT 'global',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "formulaType" TEXT NOT NULL DEFAULT 'fixed_multiplier',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "sourceType" TEXT NOT NULL DEFAULT 'custom',
    "sourceId" TEXT,
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateFactorLibraryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'Productivity',
    "impact" TEXT NOT NULL DEFAULT 'labor_hours',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "appliesTo" TEXT NOT NULL DEFAULT 'Labour',
    "applicationScope" TEXT NOT NULL DEFAULT 'both',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "formulaType" TEXT NOT NULL DEFAULT 'fixed_multiplier',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "sourceType" TEXT NOT NULL DEFAULT 'custom',
    "sourceId" TEXT,
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateFactorLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summary_rows" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'heading',
    "label" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "style" TEXT NOT NULL DEFAULT 'normal',
    "sourceCategory" TEXT,
    "sourcePhase" TEXT,
    "sourceCategoryId" TEXT,
    "sourceCategoryLabel" TEXT,
    "sourcePhaseId" TEXT,
    "sourceWorksheetId" TEXT,
    "sourceWorksheetLabel" TEXT,
    "sourceClassificationId" TEXT,
    "sourceClassificationLabel" TEXT,
    "sourceAdjustmentId" TEXT,
    "computedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "summary_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condition" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'inclusion',
    "value" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "revisionId" TEXT,
    "sourceScheduleId" TEXT,
    "effectiveDate" TEXT,
    "expiryDate" TEXT,
    "defaultMarkup" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "autoCalculate" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateBookAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rateScheduleId" TEXT NOT NULL,
    "customerId" TEXT,
    "projectId" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TEXT,
    "expiryDate" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBookAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateScheduleTier" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uom" TEXT,

    CONSTRAINT "RateScheduleTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateScheduleItem" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "resourceId" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'HR',
    "rates" JSONB NOT NULL DEFAULT '{}',
    "costRates" JSONB NOT NULL DEFAULT '{}',
    "burden" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perDiem" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSection" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL DEFAULT 'text',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentSectionId" TEXT,

    CONSTRAINT "ReportSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "foreman" TEXT NOT NULL DEFAULT '',
    "projectManager" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT,
    "shipDate" TEXT,
    "poNumber" TEXT NOT NULL DEFAULT '',
    "poIssuer" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'file',
    "scope" TEXT NOT NULL DEFAULT 'project',
    "fileType" TEXT,
    "size" INTEGER,
    "documentId" TEXT,
    "storagePath" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "FileNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffAnnotation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "annotationType" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "lineThickness" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "groupName" TEXT NOT NULL DEFAULT '',
    "points" JSONB NOT NULL DEFAULT '[]',
    "measurement" JSONB NOT NULL DEFAULT '{}',
    "calibration" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakeoffAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "worksheetItemId" TEXT NOT NULL,
    "quantityField" TEXT NOT NULL DEFAULT 'value',
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "derivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TakeoffLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DwgEntityLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT '',
    "layer" TEXT NOT NULL DEFAULT '',
    "worksheetItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "derivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selection" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DwgEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "fileNodeId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'indexed',
    "units" TEXT NOT NULL DEFAULT '',
    "checksum" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL DEFAULT '',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "bom" JSONB NOT NULL DEFAULT '[]',
    "elementStats" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelElement" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "elementClass" TEXT NOT NULL DEFAULT '',
    "elementType" TEXT NOT NULL DEFAULT '',
    "system" TEXT NOT NULL DEFAULT '',
    "level" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "bbox" JSONB NOT NULL DEFAULT '{}',
    "geometryRef" TEXT NOT NULL DEFAULT '',
    "classification" JSONB NOT NULL DEFAULT '{}',
    "lod" TEXT NOT NULL DEFAULT '',
    "lodSource" TEXT NOT NULL DEFAULT '',
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelQuantity" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "elementId" TEXT,
    "quantityType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'computed',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelBom" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "grouping" TEXT NOT NULL DEFAULT 'native',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelBom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelTakeoffLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelElementId" TEXT,
    "modelQuantityId" TEXT,
    "worksheetItemId" TEXT NOT NULL,
    "quantityField" TEXT NOT NULL DEFAULT 'quantity',
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "derivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selection" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelTakeoffLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelFederation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "revisionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelFederation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelFederationMember" (
    "id" TEXT NOT NULL,
    "federationId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL DEFAULT 'other',
    "role" TEXT NOT NULL DEFAULT 'primary',
    "position" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelFederationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelIssue" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "elementId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "code" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRevisionDiff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "baseModelId" TEXT NOT NULL,
    "headModelId" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRevisionDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT NOT NULL DEFAULT '',
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "coverage" JSONB NOT NULL DEFAULT '[]',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "competitiveness" JSONB NOT NULL DEFAULT '{}',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateStrategy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "personaId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentStage" TEXT NOT NULL DEFAULT 'scope',
    "scopeGraph" JSONB NOT NULL DEFAULT '{}',
    "executionPlan" JSONB NOT NULL DEFAULT '{}',
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "packagePlan" JSONB NOT NULL DEFAULT '[]',
    "benchmarkProfile" JSONB NOT NULL DEFAULT '{}',
    "benchmarkComparables" JSONB NOT NULL DEFAULT '[]',
    "adjustmentPlan" JSONB NOT NULL DEFAULT '[]',
    "reconcileReport" JSONB NOT NULL DEFAULT '{}',
    "confidenceSummary" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "reviewCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateCalibrationFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "strategyId" TEXT,
    "quoteReviewId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "feedbackType" TEXT NOT NULL DEFAULT 'comparison',
    "sourceLabel" TEXT NOT NULL DEFAULT '',
    "aiSnapshot" JSONB NOT NULL DEFAULT '{}',
    "humanSnapshot" JSONB NOT NULL DEFAULT '{}',
    "deltaSummary" JSONB NOT NULL DEFAULT '{}',
    "corrections" JSONB NOT NULL DEFAULT '[]',
    "lessons" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateCalibrationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aiRunId" TEXT,
    "sourceDocumentId" TEXT,
    "resourceType" TEXT NOT NULL DEFAULT 'source_document',
    "resourceKey" TEXT NOT NULL DEFAULT '',
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceDescription" TEXT NOT NULL DEFAULT '',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostVendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT NOT NULL DEFAULT '',
    "contactInfo" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostVendorProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "resourceId" TEXT,
    "sku" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "defaultUom" TEXT NOT NULL DEFAULT 'EA',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostVendorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceCatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "resourceType" TEXT NOT NULL DEFAULT 'material',
    "category" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "manufacturerPartNumber" TEXT NOT NULL DEFAULT '',
    "defaultUom" TEXT NOT NULL DEFAULT 'EA',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceId" TEXT,
    "vendorId" TEXT,
    "vendorProductId" TEXT,
    "projectId" TEXT,
    "sourceDocumentId" TEXT,
    "vendorName" TEXT NOT NULL DEFAULT '',
    "vendorSku" TEXT NOT NULL DEFAULT '',
    "documentType" TEXT NOT NULL DEFAULT 'manual',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "observedUom" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "freight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "rawText" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EffectiveCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceId" TEXT,
    "vendorId" TEXT,
    "vendorProductId" TEXT,
    "projectId" TEXT,
    "vendorName" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TEXT,
    "expiresAt" TEXT,
    "sourceObservationId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'latest_observation',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EffectiveCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assembly" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assembly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyParameter" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "paramType" TEXT NOT NULL DEFAULT 'number',
    "defaultValue" TEXT NOT NULL DEFAULT '0',
    "unit" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssemblyParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyInstance" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "assemblyId" TEXT,
    "phaseId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "parameterValues" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssemblyInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssemblyComponent" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "rateScheduleItemId" TEXT,
    "laborUnitId" TEXT,
    "costResourceId" TEXT,
    "effectiveCostId" TEXT,
    "subAssemblyId" TEXT,
    "quantityExpr" TEXT NOT NULL DEFAULT '1',
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "uomOverride" TEXT,
    "costOverride" DOUBLE PRECISION,
    "markupOverride" DOUBLE PRECISION,
    "parameterBindings" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssemblyComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionLibraryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ConditionLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT NOT NULL DEFAULT '',
    "llmDescription" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "author" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "configSchema" JSONB,
    "toolDefinitions" JSONB NOT NULL DEFAULT '[]',
    "defaultOutputType" TEXT,
    "supportedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documentation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginExecution" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "worksheetId" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "formState" JSONB,
    "output" JSONB NOT NULL DEFAULT '{}',
    "appliedLineItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "executedBy" TEXT,
    "agentSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItemSearchDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'select',
    "category" TEXT NOT NULL DEFAULT '',
    "entityType" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT NOT NULL DEFAULT '',
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "unitCost" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "searchText" TEXT NOT NULL DEFAULT '',
    "searchVector" tsvector NOT NULL DEFAULT ''::tsvector,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineItemSearchDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cabinetId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "sourceFileName" TEXT NOT NULL DEFAULT '',
    "sourceFileSize" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "sectionTitle" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cabinetId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "contentJson" JSONB NOT NULL DEFAULT '{}',
    "contentMarkdown" TEXT NOT NULL DEFAULT '',
    "plainText" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageId" TEXT,
    "sectionTitle" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "KnowledgeDocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLibraryCabinet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "itemType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeLibraryCabinet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "cabinetId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'custom',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "projectId" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceDescription" TEXT NOT NULL DEFAULT '',
    "sourceBookId" TEXT,
    "sourcePages" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatasetRow" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborUnitLibrary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "cabinetId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT '',
    "discipline" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceDescription" TEXT NOT NULL DEFAULT '',
    "sourceDatasetId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborUnitLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaborUnit" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "discipline" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "className" TEXT NOT NULL DEFAULT '',
    "subClassName" TEXT NOT NULL DEFAULT '',
    "outputUom" TEXT NOT NULL DEFAULT 'EA',
    "hoursNormal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entityCategoryType" TEXT NOT NULL DEFAULT 'Labour',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaborUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "shortform" TEXT NOT NULL DEFAULT '',
    "defaultUom" TEXT NOT NULL DEFAULT 'EA',
    "validUoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "editableFields" JSONB NOT NULL DEFAULT '{}',
    "laborHourLabels" JSONB NOT NULL DEFAULT '{}',
    "calculationType" TEXT NOT NULL DEFAULT 'manual',
    "calcFormula" TEXT NOT NULL DEFAULT '',
    "itemSource" TEXT NOT NULL DEFAULT 'freeform',
    "catalogId" TEXT,
    "analyticsBucket" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EntityCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredPackage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL DEFAULT '',
    "originalFileName" TEXT NOT NULL DEFAULT '',
    "sourceKind" TEXT NOT NULL DEFAULT 'project',
    "storagePath" TEXT NOT NULL DEFAULT '',
    "reportPath" TEXT,
    "chunksPath" TEXT,
    "checksum" TEXT NOT NULL DEFAULT '',
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unknownFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "StoredPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "packageId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "storagePath" TEXT,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "addressStreet" TEXT NOT NULL DEFAULT '',
    "addressCity" TEXT NOT NULL DEFAULT '',
    "addressProvince" TEXT NOT NULL DEFAULT '',
    "addressPostalCode" TEXT NOT NULL DEFAULT '',
    "addressCountry" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "manifestSource" TEXT NOT NULL DEFAULT 'builtin',
    "manifestSnapshot" JSONB NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'needs_auth',
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exposeToAgent" BOOLEAN NOT NULL DEFAULT true,
    "exposeToMcp" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyContext" TEXT NOT NULL DEFAULT '',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3),
    "refreshAfter" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotatedFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncState" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "cursor" TEXT,
    "fullSyncAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "recordsTotal" INTEGER NOT NULL DEFAULT 0,
    "recordsLast" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "schedule" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "headers" JSONB NOT NULL DEFAULT '{}',
    "signatureValid" BOOLEAN,
    "externalId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRun" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invokedBy" TEXT NOT NULL DEFAULT 'user',
    "agentSessionId" TEXT,
    "userId" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRecord" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "mappedTo" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE INDEX "EstimatorPersona_organizationId_idx" ON "EstimatorPersona"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "SourceDocument_projectId_idx" ON "SourceDocument"("projectId");

-- CreateIndex
CREATE INDEX "Quote_projectId_idx" ON "Quote"("projectId");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_departmentId_idx" ON "Quote"("departmentId");

-- CreateIndex
CREATE INDEX "QuoteRevision_quoteId_idx" ON "QuoteRevision"("quoteId");

-- CreateIndex
CREATE INDEX "WorksheetFolder_revisionId_idx" ON "WorksheetFolder"("revisionId");

-- CreateIndex
CREATE INDEX "WorksheetFolder_parentId_idx" ON "WorksheetFolder"("parentId");

-- CreateIndex
CREATE INDEX "Worksheet_revisionId_idx" ON "Worksheet"("revisionId");

-- CreateIndex
CREATE INDEX "Worksheet_folderId_idx" ON "Worksheet"("folderId");

-- CreateIndex
CREATE INDEX "WorksheetItem_worksheetId_idx" ON "WorksheetItem"("worksheetId");

-- CreateIndex
CREATE INDEX "WorksheetItem_phaseId_idx" ON "WorksheetItem"("phaseId");

-- CreateIndex
CREATE INDEX "WorksheetItem_categoryId_idx" ON "WorksheetItem"("categoryId");

-- CreateIndex
CREATE INDEX "WorksheetItem_costCode_idx" ON "WorksheetItem"("costCode");

-- CreateIndex
CREATE INDEX "WorksheetItem_costResourceId_idx" ON "WorksheetItem"("costResourceId");

-- CreateIndex
CREATE INDEX "WorksheetItem_effectiveCostId_idx" ON "WorksheetItem"("effectiveCostId");

-- CreateIndex
CREATE INDEX "WorksheetItem_laborUnitId_idx" ON "WorksheetItem"("laborUnitId");

-- CreateIndex
CREATE INDEX "WorksheetItem_sourceAssemblyId_idx" ON "WorksheetItem"("sourceAssemblyId");

-- CreateIndex
CREATE INDEX "WorksheetItem_assemblyInstanceId_idx" ON "WorksheetItem"("assemblyInstanceId");

-- CreateIndex
CREATE INDEX "Phase_revisionId_idx" ON "Phase"("revisionId");

-- CreateIndex
CREATE INDEX "Phase_parentId_idx" ON "Phase"("parentId");

-- CreateIndex
CREATE INDEX "ScheduleTask_projectId_idx" ON "ScheduleTask"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleTask_revisionId_idx" ON "ScheduleTask"("revisionId");

-- CreateIndex
CREATE INDEX "ScheduleTask_phaseId_idx" ON "ScheduleTask"("phaseId");

-- CreateIndex
CREATE INDEX "ScheduleTask_calendarId_idx" ON "ScheduleTask"("calendarId");

-- CreateIndex
CREATE INDEX "ScheduleTask_parentTaskId_idx" ON "ScheduleTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "ScheduleDependency_predecessorId_idx" ON "ScheduleDependency"("predecessorId");

-- CreateIndex
CREATE INDEX "ScheduleDependency_successorId_idx" ON "ScheduleDependency"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDependency_predecessorId_successorId_key" ON "ScheduleDependency"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "ScheduleCalendar_projectId_idx" ON "ScheduleCalendar"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleCalendar_revisionId_idx" ON "ScheduleCalendar"("revisionId");

-- CreateIndex
CREATE INDEX "ScheduleBaseline_projectId_idx" ON "ScheduleBaseline"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleBaseline_revisionId_idx" ON "ScheduleBaseline"("revisionId");

-- CreateIndex
CREATE INDEX "ScheduleBaselineTask_taskId_idx" ON "ScheduleBaselineTask"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBaselineTask_baselineId_taskId_key" ON "ScheduleBaselineTask"("baselineId", "taskId");

-- CreateIndex
CREATE INDEX "ScheduleResource_projectId_idx" ON "ScheduleResource"("projectId");

-- CreateIndex
CREATE INDEX "ScheduleResource_revisionId_idx" ON "ScheduleResource"("revisionId");

-- CreateIndex
CREATE INDEX "ScheduleResource_calendarId_idx" ON "ScheduleResource"("calendarId");

-- CreateIndex
CREATE INDEX "ScheduleTaskAssignment_resourceId_idx" ON "ScheduleTaskAssignment"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTaskAssignment_taskId_resourceId_key" ON "ScheduleTaskAssignment"("taskId", "resourceId");

-- CreateIndex
CREATE INDEX "Modifier_revisionId_idx" ON "Modifier"("revisionId");

-- CreateIndex
CREATE INDEX "AdditionalLineItem_revisionId_idx" ON "AdditionalLineItem"("revisionId");

-- CreateIndex
CREATE INDEX "Adjustment_revisionId_idx" ON "Adjustment"("revisionId");

-- CreateIndex
CREATE INDEX "EstimateFactor_revisionId_idx" ON "EstimateFactor"("revisionId");

-- CreateIndex
CREATE INDEX "EstimateFactor_sourceType_idx" ON "EstimateFactor"("sourceType");

-- CreateIndex
CREATE INDEX "EstimateFactorLibraryEntry_organizationId_idx" ON "EstimateFactorLibraryEntry"("organizationId");

-- CreateIndex
CREATE INDEX "EstimateFactorLibraryEntry_sourceType_idx" ON "EstimateFactorLibraryEntry"("sourceType");

-- CreateIndex
CREATE INDEX "summary_rows_revisionId_idx" ON "summary_rows"("revisionId");

-- CreateIndex
CREATE INDEX "Condition_revisionId_idx" ON "Condition"("revisionId");

-- CreateIndex
CREATE INDEX "RateSchedule_organizationId_idx" ON "RateSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "RateSchedule_revisionId_idx" ON "RateSchedule"("revisionId");

-- CreateIndex
CREATE INDEX "RateBookAssignment_organizationId_idx" ON "RateBookAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "RateBookAssignment_rateScheduleId_idx" ON "RateBookAssignment"("rateScheduleId");

-- CreateIndex
CREATE INDEX "RateBookAssignment_customerId_idx" ON "RateBookAssignment"("customerId");

-- CreateIndex
CREATE INDEX "RateBookAssignment_projectId_idx" ON "RateBookAssignment"("projectId");

-- CreateIndex
CREATE INDEX "RateBookAssignment_organizationId_customerId_category_idx" ON "RateBookAssignment"("organizationId", "customerId", "category");

-- CreateIndex
CREATE INDEX "RateBookAssignment_organizationId_projectId_category_idx" ON "RateBookAssignment"("organizationId", "projectId", "category");

-- CreateIndex
CREATE INDEX "RateScheduleTier_scheduleId_idx" ON "RateScheduleTier"("scheduleId");

-- CreateIndex
CREATE INDEX "RateScheduleItem_scheduleId_idx" ON "RateScheduleItem"("scheduleId");

-- CreateIndex
CREATE INDEX "RateScheduleItem_catalogItemId_idx" ON "RateScheduleItem"("catalogItemId");

-- CreateIndex
CREATE INDEX "RateScheduleItem_resourceId_idx" ON "RateScheduleItem"("resourceId");

-- CreateIndex
CREATE INDEX "ReportSection_revisionId_idx" ON "ReportSection"("revisionId");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "FileNode_projectId_idx" ON "FileNode"("projectId");

-- CreateIndex
CREATE INDEX "FileNode_parentId_idx" ON "FileNode"("parentId");

-- CreateIndex
CREATE INDEX "FileNode_scope_idx" ON "FileNode"("scope");

-- CreateIndex
CREATE INDEX "TakeoffAnnotation_projectId_idx" ON "TakeoffAnnotation"("projectId");

-- CreateIndex
CREATE INDEX "TakeoffAnnotation_documentId_idx" ON "TakeoffAnnotation"("documentId");

-- CreateIndex
CREATE INDEX "TakeoffLink_annotationId_idx" ON "TakeoffLink"("annotationId");

-- CreateIndex
CREATE INDEX "TakeoffLink_worksheetItemId_idx" ON "TakeoffLink"("worksheetItemId");

-- CreateIndex
CREATE INDEX "TakeoffLink_projectId_idx" ON "TakeoffLink"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TakeoffLink_annotationId_worksheetItemId_key" ON "TakeoffLink"("annotationId", "worksheetItemId");

-- CreateIndex
CREATE INDEX "DwgEntityLink_projectId_idx" ON "DwgEntityLink"("projectId");

-- CreateIndex
CREATE INDEX "DwgEntityLink_documentId_idx" ON "DwgEntityLink"("documentId");

-- CreateIndex
CREATE INDEX "DwgEntityLink_entityId_idx" ON "DwgEntityLink"("entityId");

-- CreateIndex
CREATE INDEX "DwgEntityLink_worksheetItemId_idx" ON "DwgEntityLink"("worksheetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DwgEntityLink_documentId_entityId_worksheetItemId_key" ON "DwgEntityLink"("documentId", "entityId", "worksheetItemId");

-- CreateIndex
CREATE INDEX "ModelAsset_projectId_idx" ON "ModelAsset"("projectId");

-- CreateIndex
CREATE INDEX "ModelAsset_sourceDocumentId_idx" ON "ModelAsset"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "ModelAsset_fileNodeId_idx" ON "ModelAsset"("fileNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelAsset_projectId_sourceDocumentId_key" ON "ModelAsset"("projectId", "sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelAsset_projectId_fileNodeId_key" ON "ModelAsset"("projectId", "fileNodeId");

-- CreateIndex
CREATE INDEX "ModelElement_modelId_idx" ON "ModelElement"("modelId");

-- CreateIndex
CREATE INDEX "ModelElement_modelId_externalId_idx" ON "ModelElement"("modelId", "externalId");

-- CreateIndex
CREATE INDEX "ModelElement_elementClass_idx" ON "ModelElement"("elementClass");

-- CreateIndex
CREATE INDEX "ModelElement_lod_idx" ON "ModelElement"("lod");

-- CreateIndex
CREATE INDEX "ModelQuantity_modelId_idx" ON "ModelQuantity"("modelId");

-- CreateIndex
CREATE INDEX "ModelQuantity_elementId_idx" ON "ModelQuantity"("elementId");

-- CreateIndex
CREATE INDEX "ModelQuantity_quantityType_idx" ON "ModelQuantity"("quantityType");

-- CreateIndex
CREATE INDEX "ModelBom_modelId_idx" ON "ModelBom"("modelId");

-- CreateIndex
CREATE INDEX "ModelTakeoffLink_projectId_idx" ON "ModelTakeoffLink"("projectId");

-- CreateIndex
CREATE INDEX "ModelTakeoffLink_modelId_idx" ON "ModelTakeoffLink"("modelId");

-- CreateIndex
CREATE INDEX "ModelTakeoffLink_modelElementId_idx" ON "ModelTakeoffLink"("modelElementId");

-- CreateIndex
CREATE INDEX "ModelTakeoffLink_modelQuantityId_idx" ON "ModelTakeoffLink"("modelQuantityId");

-- CreateIndex
CREATE INDEX "ModelTakeoffLink_worksheetItemId_idx" ON "ModelTakeoffLink"("worksheetItemId");

-- CreateIndex
CREATE INDEX "ModelFederation_projectId_idx" ON "ModelFederation"("projectId");

-- CreateIndex
CREATE INDEX "ModelFederation_revisionId_idx" ON "ModelFederation"("revisionId");

-- CreateIndex
CREATE INDEX "ModelFederationMember_federationId_idx" ON "ModelFederationMember"("federationId");

-- CreateIndex
CREATE INDEX "ModelFederationMember_modelId_idx" ON "ModelFederationMember"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelFederationMember_federationId_modelId_key" ON "ModelFederationMember"("federationId", "modelId");

-- CreateIndex
CREATE INDEX "ModelIssue_modelId_idx" ON "ModelIssue"("modelId");

-- CreateIndex
CREATE INDEX "ModelIssue_elementId_idx" ON "ModelIssue"("elementId");

-- CreateIndex
CREATE INDEX "ModelIssue_severity_idx" ON "ModelIssue"("severity");

-- CreateIndex
CREATE INDEX "ModelRevisionDiff_projectId_idx" ON "ModelRevisionDiff"("projectId");

-- CreateIndex
CREATE INDEX "ModelRevisionDiff_baseModelId_idx" ON "ModelRevisionDiff"("baseModelId");

-- CreateIndex
CREATE INDEX "ModelRevisionDiff_headModelId_idx" ON "ModelRevisionDiff"("headModelId");

-- CreateIndex
CREATE INDEX "AiRun_projectId_idx" ON "AiRun"("projectId");

-- CreateIndex
CREATE INDEX "QuoteReview_projectId_idx" ON "QuoteReview"("projectId");

-- CreateIndex
CREATE INDEX "QuoteReview_revisionId_idx" ON "QuoteReview"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateStrategy_revisionId_key" ON "EstimateStrategy"("revisionId");

-- CreateIndex
CREATE INDEX "EstimateStrategy_projectId_idx" ON "EstimateStrategy"("projectId");

-- CreateIndex
CREATE INDEX "EstimateStrategy_status_idx" ON "EstimateStrategy"("status");

-- CreateIndex
CREATE INDEX "EstimateCalibrationFeedback_projectId_idx" ON "EstimateCalibrationFeedback"("projectId");

-- CreateIndex
CREATE INDEX "EstimateCalibrationFeedback_revisionId_idx" ON "EstimateCalibrationFeedback"("revisionId");

-- CreateIndex
CREATE INDEX "EstimateCalibrationFeedback_strategyId_idx" ON "EstimateCalibrationFeedback"("strategyId");

-- CreateIndex
CREATE INDEX "Citation_projectId_idx" ON "Citation"("projectId");

-- CreateIndex
CREATE INDEX "Activity_projectId_idx" ON "Activity"("projectId");

-- CreateIndex
CREATE INDEX "Catalog_organizationId_idx" ON "Catalog"("organizationId");

-- CreateIndex
CREATE INDEX "Catalog_isTemplate_idx" ON "Catalog"("isTemplate");

-- CreateIndex
CREATE INDEX "CatalogItem_catalogId_idx" ON "CatalogItem"("catalogId");

-- CreateIndex
CREATE INDEX "CostVendor_organizationId_idx" ON "CostVendor"("organizationId");

-- CreateIndex
CREATE INDEX "CostVendor_organizationId_name_idx" ON "CostVendor"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CostVendor_organizationId_normalizedName_key" ON "CostVendor"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "CostVendorProduct_organizationId_idx" ON "CostVendorProduct"("organizationId");

-- CreateIndex
CREATE INDEX "CostVendorProduct_vendorId_idx" ON "CostVendorProduct"("vendorId");

-- CreateIndex
CREATE INDEX "CostVendorProduct_resourceId_idx" ON "CostVendorProduct"("resourceId");

-- CreateIndex
CREATE INDEX "CostVendorProduct_organizationId_sku_idx" ON "CostVendorProduct"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "CostVendorProduct_vendorId_sku_normalizedName_defaultUom_key" ON "CostVendorProduct"("vendorId", "sku", "normalizedName", "defaultUom");

-- CreateIndex
CREATE INDEX "ResourceCatalogItem_organizationId_idx" ON "ResourceCatalogItem"("organizationId");

-- CreateIndex
CREATE INDEX "ResourceCatalogItem_organizationId_resourceType_idx" ON "ResourceCatalogItem"("organizationId", "resourceType");

-- CreateIndex
CREATE INDEX "ResourceCatalogItem_organizationId_code_idx" ON "ResourceCatalogItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ResourceCatalogItem_catalogItemId_idx" ON "ResourceCatalogItem"("catalogItemId");

-- CreateIndex
CREATE INDEX "PriceObservation_organizationId_idx" ON "PriceObservation"("organizationId");

-- CreateIndex
CREATE INDEX "PriceObservation_resourceId_observedAt_idx" ON "PriceObservation"("resourceId", "observedAt");

-- CreateIndex
CREATE INDEX "PriceObservation_vendorId_idx" ON "PriceObservation"("vendorId");

-- CreateIndex
CREATE INDEX "PriceObservation_vendorProductId_idx" ON "PriceObservation"("vendorProductId");

-- CreateIndex
CREATE INDEX "PriceObservation_projectId_idx" ON "PriceObservation"("projectId");

-- CreateIndex
CREATE INDEX "PriceObservation_sourceDocumentId_idx" ON "PriceObservation"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "PriceObservation_organizationId_vendorName_idx" ON "PriceObservation"("organizationId", "vendorName");

-- CreateIndex
CREATE INDEX "PriceObservation_organizationId_fingerprint_idx" ON "PriceObservation"("organizationId", "fingerprint");

-- CreateIndex
CREATE INDEX "EffectiveCost_organizationId_idx" ON "EffectiveCost"("organizationId");

-- CreateIndex
CREATE INDEX "EffectiveCost_resourceId_idx" ON "EffectiveCost"("resourceId");

-- CreateIndex
CREATE INDEX "EffectiveCost_vendorId_idx" ON "EffectiveCost"("vendorId");

-- CreateIndex
CREATE INDEX "EffectiveCost_vendorProductId_idx" ON "EffectiveCost"("vendorProductId");

-- CreateIndex
CREATE INDEX "EffectiveCost_projectId_idx" ON "EffectiveCost"("projectId");

-- CreateIndex
CREATE INDEX "EffectiveCost_sourceObservationId_idx" ON "EffectiveCost"("sourceObservationId");

-- CreateIndex
CREATE INDEX "EffectiveCost_organizationId_resourceId_uom_currency_idx" ON "EffectiveCost"("organizationId", "resourceId", "uom", "currency");

-- CreateIndex
CREATE INDEX "Assembly_organizationId_idx" ON "Assembly"("organizationId");

-- CreateIndex
CREATE INDEX "Assembly_isTemplate_idx" ON "Assembly"("isTemplate");

-- CreateIndex
CREATE INDEX "AssemblyParameter_assemblyId_idx" ON "AssemblyParameter"("assemblyId");

-- CreateIndex
CREATE UNIQUE INDEX "AssemblyParameter_assemblyId_key_key" ON "AssemblyParameter"("assemblyId", "key");

-- CreateIndex
CREATE INDEX "AssemblyInstance_worksheetId_idx" ON "AssemblyInstance"("worksheetId");

-- CreateIndex
CREATE INDEX "AssemblyInstance_assemblyId_idx" ON "AssemblyInstance"("assemblyId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_assemblyId_idx" ON "AssemblyComponent"("assemblyId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_catalogItemId_idx" ON "AssemblyComponent"("catalogItemId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_rateScheduleItemId_idx" ON "AssemblyComponent"("rateScheduleItemId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_laborUnitId_idx" ON "AssemblyComponent"("laborUnitId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_costResourceId_idx" ON "AssemblyComponent"("costResourceId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_effectiveCostId_idx" ON "AssemblyComponent"("effectiveCostId");

-- CreateIndex
CREATE INDEX "AssemblyComponent_subAssemblyId_idx" ON "AssemblyComponent"("subAssemblyId");

-- CreateIndex
CREATE INDEX "ConditionLibraryEntry_organizationId_idx" ON "ConditionLibraryEntry"("organizationId");

-- CreateIndex
CREATE INDEX "Plugin_organizationId_idx" ON "Plugin"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_organizationId_slug_key" ON "Plugin"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "PluginExecution_projectId_idx" ON "PluginExecution"("projectId");

-- CreateIndex
CREATE INDEX "PluginExecution_pluginId_idx" ON "PluginExecution"("pluginId");

-- CreateIndex
CREATE INDEX "LineItemSearchDocument_organizationId_idx" ON "LineItemSearchDocument"("organizationId");

-- CreateIndex
CREATE INDEX "LineItemSearchDocument_organizationId_projectId_idx" ON "LineItemSearchDocument"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "LineItemSearchDocument_organizationId_sourceType_idx" ON "LineItemSearchDocument"("organizationId", "sourceType");

-- CreateIndex
CREATE INDEX "LineItemSearchDocument_organizationId_category_idx" ON "LineItemSearchDocument"("organizationId", "category");

-- CreateIndex
CREATE INDEX "LineItemSearchDocument_organizationId_entityType_idx" ON "LineItemSearchDocument"("organizationId", "entityType");

-- CreateIndex
CREATE INDEX "KnowledgeBook_organizationId_idx" ON "KnowledgeBook"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeBook_cabinetId_idx" ON "KnowledgeBook"("cabinetId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_bookId_idx" ON "KnowledgeChunk"("bookId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_organizationId_idx" ON "KnowledgeDocument"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_cabinetId_idx" ON "KnowledgeDocument"("cabinetId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_scope_idx" ON "KnowledgeDocument"("scope");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_projectId_idx" ON "KnowledgeDocument"("projectId");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentPage_documentId_idx" ON "KnowledgeDocumentPage"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentPage_documentId_order_idx" ON "KnowledgeDocumentPage"("documentId", "order");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentChunk_documentId_idx" ON "KnowledgeDocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentChunk_pageId_idx" ON "KnowledgeDocumentChunk"("pageId");

-- CreateIndex
CREATE INDEX "KnowledgeLibraryCabinet_organizationId_idx" ON "KnowledgeLibraryCabinet"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeLibraryCabinet_parentId_idx" ON "KnowledgeLibraryCabinet"("parentId");

-- CreateIndex
CREATE INDEX "KnowledgeLibraryCabinet_organizationId_itemType_idx" ON "KnowledgeLibraryCabinet"("organizationId", "itemType");

-- CreateIndex
CREATE INDEX "Dataset_organizationId_idx" ON "Dataset"("organizationId");

-- CreateIndex
CREATE INDEX "Dataset_isTemplate_idx" ON "Dataset"("isTemplate");

-- CreateIndex
CREATE INDEX "Dataset_cabinetId_idx" ON "Dataset"("cabinetId");

-- CreateIndex
CREATE INDEX "DatasetRow_datasetId_idx" ON "DatasetRow"("datasetId");

-- CreateIndex
CREATE INDEX "LaborUnitLibrary_organizationId_idx" ON "LaborUnitLibrary"("organizationId");

-- CreateIndex
CREATE INDEX "LaborUnitLibrary_cabinetId_idx" ON "LaborUnitLibrary"("cabinetId");

-- CreateIndex
CREATE INDEX "LaborUnitLibrary_isTemplate_idx" ON "LaborUnitLibrary"("isTemplate");

-- CreateIndex
CREATE INDEX "LaborUnitLibrary_provider_idx" ON "LaborUnitLibrary"("provider");

-- CreateIndex
CREATE INDEX "LaborUnit_libraryId_idx" ON "LaborUnit"("libraryId");

-- CreateIndex
CREATE INDEX "LaborUnit_catalogItemId_idx" ON "LaborUnit"("catalogItemId");

-- CreateIndex
CREATE INDEX "LaborUnit_category_idx" ON "LaborUnit"("category");

-- CreateIndex
CREATE INDEX "LaborUnit_className_idx" ON "LaborUnit"("className");

-- CreateIndex
CREATE INDEX "LaborUnit_subClassName_idx" ON "LaborUnit"("subClassName");

-- CreateIndex
CREATE INDEX "LaborUnit_entityCategoryType_idx" ON "LaborUnit"("entityCategoryType");

-- CreateIndex
CREATE INDEX "EntityCategory_organizationId_idx" ON "EntityCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityCategory_organizationId_name_key" ON "EntityCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "StoredPackage_projectId_idx" ON "StoredPackage"("projectId");

-- CreateIndex
CREATE INDEX "IngestionJob_projectId_idx" ON "IngestionJob"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceState_projectId_key" ON "WorkspaceState"("projectId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE INDEX "Integration_manifestId_idx" ON "Integration"("manifestId");

-- CreateIndex
CREATE INDEX "Integration_status_idx" ON "Integration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_organizationId_slug_key" ON "Integration"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "IntegrationCredential_integrationId_idx" ON "IntegrationCredential"("integrationId");

-- CreateIndex
CREATE INDEX "IntegrationCredential_expiresAt_idx" ON "IntegrationCredential"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_integrationId_kind_key" ON "IntegrationCredential"("integrationId", "kind");

-- CreateIndex
CREATE INDEX "IntegrationSyncState_integrationId_idx" ON "IntegrationSyncState"("integrationId");

-- CreateIndex
CREATE INDEX "IntegrationSyncState_status_idx" ON "IntegrationSyncState"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSyncState_integrationId_resourceId_key" ON "IntegrationSyncState"("integrationId", "resourceId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_integrationId_idx" ON "IntegrationEvent"("integrationId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_direction_status_idx" ON "IntegrationEvent"("direction", "status");

-- CreateIndex
CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_integrationId_externalId_key" ON "IntegrationEvent"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "IntegrationRun_integrationId_idx" ON "IntegrationRun"("integrationId");

-- CreateIndex
CREATE INDEX "IntegrationRun_status_idx" ON "IntegrationRun"("status");

-- CreateIndex
CREATE INDEX "IntegrationRun_startedAt_idx" ON "IntegrationRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationRun_integrationId_idempotencyKey_key" ON "IntegrationRun"("integrationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ExternalRecord_integrationId_idx" ON "ExternalRecord"("integrationId");

-- CreateIndex
CREATE INDEX "ExternalRecord_mappedTo_idx" ON "ExternalRecord"("mappedTo");

-- CreateIndex
CREATE INDEX "ExternalRecord_fetchedAt_idx" ON "ExternalRecord"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRecord_integrationId_resourceId_externalId_key" ON "ExternalRecord"("integrationId", "resourceId", "externalId");

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatorPersona" ADD CONSTRAINT "EstimatorPersona_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetFolder" ADD CONSTRAINT "WorksheetFolder_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetFolder" ADD CONSTRAINT "WorksheetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorksheetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "WorksheetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EntityCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_costResourceId_fkey" FOREIGN KEY ("costResourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_effectiveCostId_fkey" FOREIGN KEY ("effectiveCostId") REFERENCES "EffectiveCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_laborUnitId_fkey" FOREIGN KEY ("laborUnitId") REFERENCES "LaborUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_sourceAssemblyId_fkey" FOREIGN KEY ("sourceAssemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetItem" ADD CONSTRAINT "WorksheetItem_assemblyInstanceId_fkey" FOREIGN KEY ("assemblyInstanceId") REFERENCES "AssemblyInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTask" ADD CONSTRAINT "ScheduleTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTask" ADD CONSTRAINT "ScheduleTask_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTask" ADD CONSTRAINT "ScheduleTask_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ScheduleCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTask" ADD CONSTRAINT "ScheduleTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ScheduleTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDependency" ADD CONSTRAINT "ScheduleDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "ScheduleTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDependency" ADD CONSTRAINT "ScheduleDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "ScheduleTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCalendar" ADD CONSTRAINT "ScheduleCalendar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCalendar" ADD CONSTRAINT "ScheduleCalendar_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBaseline" ADD CONSTRAINT "ScheduleBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBaseline" ADD CONSTRAINT "ScheduleBaseline_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBaselineTask" ADD CONSTRAINT "ScheduleBaselineTask_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "ScheduleBaseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleResource" ADD CONSTRAINT "ScheduleResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleResource" ADD CONSTRAINT "ScheduleResource_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleResource" ADD CONSTRAINT "ScheduleResource_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ScheduleCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTaskAssignment" ADD CONSTRAINT "ScheduleTaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ScheduleTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTaskAssignment" ADD CONSTRAINT "ScheduleTaskAssignment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ScheduleResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalLineItem" ADD CONSTRAINT "AdditionalLineItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateFactor" ADD CONSTRAINT "EstimateFactor_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateFactorLibraryEntry" ADD CONSTRAINT "EstimateFactorLibraryEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summary_rows" ADD CONSTRAINT "summary_rows_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Condition" ADD CONSTRAINT "Condition_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateSchedule" ADD CONSTRAINT "RateSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateSchedule" ADD CONSTRAINT "RateSchedule_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateBookAssignment" ADD CONSTRAINT "RateBookAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateBookAssignment" ADD CONSTRAINT "RateBookAssignment_rateScheduleId_fkey" FOREIGN KEY ("rateScheduleId") REFERENCES "RateSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateBookAssignment" ADD CONSTRAINT "RateBookAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateBookAssignment" ADD CONSTRAINT "RateBookAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateScheduleTier" ADD CONSTRAINT "RateScheduleTier_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RateSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateScheduleItem" ADD CONSTRAINT "RateScheduleItem_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RateSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateScheduleItem" ADD CONSTRAINT "RateScheduleItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateScheduleItem" ADD CONSTRAINT "RateScheduleItem_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSection" ADD CONSTRAINT "ReportSection_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileNode" ADD CONSTRAINT "FileNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffAnnotation" ADD CONSTRAINT "TakeoffAnnotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffLink" ADD CONSTRAINT "TakeoffLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffLink" ADD CONSTRAINT "TakeoffLink_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "TakeoffAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffLink" ADD CONSTRAINT "TakeoffLink_worksheetItemId_fkey" FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DwgEntityLink" ADD CONSTRAINT "DwgEntityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DwgEntityLink" ADD CONSTRAINT "DwgEntityLink_worksheetItemId_fkey" FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAsset" ADD CONSTRAINT "ModelAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAsset" ADD CONSTRAINT "ModelAsset_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelAsset" ADD CONSTRAINT "ModelAsset_fileNodeId_fkey" FOREIGN KEY ("fileNodeId") REFERENCES "FileNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelElement" ADD CONSTRAINT "ModelElement_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelElement" ADD CONSTRAINT "ModelElement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelQuantity" ADD CONSTRAINT "ModelQuantity_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelQuantity" ADD CONSTRAINT "ModelQuantity_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelBom" ADD CONSTRAINT "ModelBom_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTakeoffLink" ADD CONSTRAINT "ModelTakeoffLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTakeoffLink" ADD CONSTRAINT "ModelTakeoffLink_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTakeoffLink" ADD CONSTRAINT "ModelTakeoffLink_modelElementId_fkey" FOREIGN KEY ("modelElementId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTakeoffLink" ADD CONSTRAINT "ModelTakeoffLink_modelQuantityId_fkey" FOREIGN KEY ("modelQuantityId") REFERENCES "ModelQuantity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelTakeoffLink" ADD CONSTRAINT "ModelTakeoffLink_worksheetItemId_fkey" FOREIGN KEY ("worksheetItemId") REFERENCES "WorksheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFederation" ADD CONSTRAINT "ModelFederation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFederation" ADD CONSTRAINT "ModelFederation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFederationMember" ADD CONSTRAINT "ModelFederationMember_federationId_fkey" FOREIGN KEY ("federationId") REFERENCES "ModelFederation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelFederationMember" ADD CONSTRAINT "ModelFederationMember_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelIssue" ADD CONSTRAINT "ModelIssue_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelIssue" ADD CONSTRAINT "ModelIssue_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRevisionDiff" ADD CONSTRAINT "ModelRevisionDiff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRevisionDiff" ADD CONSTRAINT "ModelRevisionDiff_baseModelId_fkey" FOREIGN KEY ("baseModelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelRevisionDiff" ADD CONSTRAINT "ModelRevisionDiff_headModelId_fkey" FOREIGN KEY ("headModelId") REFERENCES "ModelAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteReview" ADD CONSTRAINT "QuoteReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateStrategy" ADD CONSTRAINT "EstimateStrategy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateStrategy" ADD CONSTRAINT "EstimateStrategy_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateCalibrationFeedback" ADD CONSTRAINT "EstimateCalibrationFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateCalibrationFeedback" ADD CONSTRAINT "EstimateCalibrationFeedback_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "QuoteRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateCalibrationFeedback" ADD CONSTRAINT "EstimateCalibrationFeedback_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "EstimateStrategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateCalibrationFeedback" ADD CONSTRAINT "EstimateCalibrationFeedback_quoteReviewId_fkey" FOREIGN KEY ("quoteReviewId") REFERENCES "QuoteReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostVendor" ADD CONSTRAINT "CostVendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostVendorProduct" ADD CONSTRAINT "CostVendorProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostVendorProduct" ADD CONSTRAINT "CostVendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostVendorProduct" ADD CONSTRAINT "CostVendorProduct_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceCatalogItem" ADD CONSTRAINT "ResourceCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceCatalogItem" ADD CONSTRAINT "ResourceCatalogItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "CostVendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "CostVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "CostVendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectiveCost" ADD CONSTRAINT "EffectiveCost_sourceObservationId_fkey" FOREIGN KEY ("sourceObservationId") REFERENCES "PriceObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assembly" ADD CONSTRAINT "Assembly_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyParameter" ADD CONSTRAINT "AssemblyParameter_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyInstance" ADD CONSTRAINT "AssemblyInstance_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyInstance" ADD CONSTRAINT "AssemblyInstance_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "Assembly"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_rateScheduleItemId_fkey" FOREIGN KEY ("rateScheduleItemId") REFERENCES "RateScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_laborUnitId_fkey" FOREIGN KEY ("laborUnitId") REFERENCES "LaborUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_costResourceId_fkey" FOREIGN KEY ("costResourceId") REFERENCES "ResourceCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_effectiveCostId_fkey" FOREIGN KEY ("effectiveCostId") REFERENCES "EffectiveCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssemblyComponent" ADD CONSTRAINT "AssemblyComponent_subAssemblyId_fkey" FOREIGN KEY ("subAssemblyId") REFERENCES "Assembly"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionLibraryEntry" ADD CONSTRAINT "ConditionLibraryEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plugin" ADD CONSTRAINT "Plugin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginExecution" ADD CONSTRAINT "PluginExecution_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "Plugin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginExecution" ADD CONSTRAINT "PluginExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBook" ADD CONSTRAINT "KnowledgeBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBook" ADD CONSTRAINT "KnowledgeBook_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "KnowledgeBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentPage" ADD CONSTRAINT "KnowledgeDocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentChunk" ADD CONSTRAINT "KnowledgeDocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocumentChunk" ADD CONSTRAINT "KnowledgeDocumentChunk_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "KnowledgeDocumentPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLibraryCabinet" ADD CONSTRAINT "KnowledgeLibraryCabinet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLibraryCabinet" ADD CONSTRAINT "KnowledgeLibraryCabinet_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatasetRow" ADD CONSTRAINT "DatasetRow_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborUnitLibrary" ADD CONSTRAINT "LaborUnitLibrary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborUnitLibrary" ADD CONSTRAINT "LaborUnitLibrary_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "KnowledgeLibraryCabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborUnit" ADD CONSTRAINT "LaborUnit_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "LaborUnitLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaborUnit" ADD CONSTRAINT "LaborUnit_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityCategory" ADD CONSTRAINT "EntityCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredPackage" ADD CONSTRAINT "StoredPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceState" ADD CONSTRAINT "WorkspaceState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncState" ADD CONSTRAINT "IntegrationSyncState_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationRun" ADD CONSTRAINT "IntegrationRun_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalRecord" ADD CONSTRAINT "ExternalRecord_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

