-- Recovery preflight for a failed earlier deploy of
-- 20260516010000_rename_takeoff_link_to_pickup_link. That migration's original
-- SQL had a redundant ALTER INDEX after ALTER TABLE … RENAME CONSTRAINT
-- (the latter already cascades the pkey index rename in Postgres), so the
-- transaction rolled back but Prisma left a sentinel row in _prisma_migrations
-- with finished_at IS NULL, which blocks every subsequent `migrate deploy`.
-- Clear the sentinel so the corrected migration can run cleanly. Idempotent:
-- once Prisma records a successful run, this becomes a no-op.

CREATE OR REPLACE FUNCTION bidwright_preflight_clear_failed_pickup_link_migration()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NULL THEN
    RAISE NOTICE 'Skipping failed PickupLink migration clear; _prisma_migrations table not present.';
    RETURN;
  END IF;

  DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260516010000_rename_takeoff_link_to_pickup_link'
    AND finished_at IS NULL;
END;
$$;

SELECT bidwright_preflight_clear_failed_pickup_link_migration();
DROP FUNCTION bidwright_preflight_clear_failed_pickup_link_migration();
