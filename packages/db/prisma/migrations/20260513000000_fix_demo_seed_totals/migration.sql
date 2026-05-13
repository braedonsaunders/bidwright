-- Repair sample data that was seeded with extended line totals in WorksheetItem.cost.
-- The application contract is per-unit cost; live totals compute quantity * cost.

UPDATE "WorksheetItem"
SET
  "cost" = 119040.0 / 1480.0,
  "markup" = 0.6
WHERE
  "id" = 'li-1'
  AND "entityName" = 'Journeyman Pipefitter'
  AND "quantity" = 1480
  AND "cost" = 119040;

UPDATE "WorksheetItem"
SET "markup" = 0.25
WHERE
  "id" = 'li-2'
  AND "entityName" = 'Pipe and Fittings'
  AND "markup" = 0.24;

UPDATE "WorksheetItem"
SET "cost" = 18500.0 / 4.0
WHERE
  "id" = 'li-3'
  AND "entityName" = '75 Ton Crane'
  AND "quantity" = 4
  AND "cost" = 18500;

UPDATE "WorksheetItem"
SET "cost" = 100
WHERE
  "id" = 'li-7'
  AND "entityName" = 'Commissioning Crew'
  AND "quantity" = 1100
  AND "cost" = 110000;

UPDATE "QuoteRevision"
SET
  "grandTotal" = 1330268.12,
  "subtotal" = 1330268.12,
  "cost" = 969040,
  "estimatedProfit" = 361228.12,
  "estimatedMargin" = 0.27,
  "calculatedTotal" = 1330268.12,
  "pricingLadder" = '{
    "version": 1,
    "directCost": 969040,
    "lineSubtotal": 1239854,
    "adjustmentTotal": 90414.12,
    "netTotal": 1330268.12,
    "grandTotal": 1330268.12,
    "internalProfit": 361228.12,
    "internalMargin": 0.27,
    "rows": []
  }'::jsonb
WHERE
  "id" = 'rev-0'
  AND "quoteId" = 'quote-main';

UPDATE "EntityCategory"
SET "itemSource" = 'freeform'
WHERE
  "name" = 'Rental Equipment'
  AND "entityType" = 'RentalEquipment'
  AND "itemSource" = 'rate_schedule'
  AND "isBuiltIn" = true;
