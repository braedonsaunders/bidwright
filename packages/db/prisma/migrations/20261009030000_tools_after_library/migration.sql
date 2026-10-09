-- Default navigation now lists Tools immediately after Library. Existing
-- tenants keep their saved order, so place Tools after Library for the
-- Rassaun organization without changing any other destination's position
-- or visibility.
DO $$
DECLARE
  rec RECORD;
  nav jsonb;
  items jsonb;
  rebuilt jsonb;
  elem jsonb;
  tools_item jsonb;
  inserted boolean;
  i int;
  canonical jsonb := '["dashboard","projects","intake","quotes","clients","library","tools","performance","settings","profile"]'::jsonb;
  known jsonb;
  default_items jsonb := '[
    {"key":"dashboard"},
    {"key":"projects"},
    {"key":"intake"},
    {"key":"quotes"},
    {"key":"clients"},
    {"key":"library"},
    {"key":"tools"},
    {"key":"performance"},
    {"key":"settings"},
    {"key":"profile"}
  ]'::jsonb;
BEGIN
  FOR rec IN
    SELECT s.id, s.general, o.slug
    FROM "OrganizationSettings" s
    JOIN "Organization" o ON o.id = s."organizationId"
    WHERE o.slug ILIKE '%rassaun%' OR o.name ILIKE '%rassaun%'
  LOOP
    nav := rec.general->'navigation';
    items := nav->'items';
    tools_item := '{"key":"tools"}'::jsonb;

    IF nav IS NULL OR items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
      rebuilt := default_items;
      known := canonical;
    ELSE
      FOR i IN 0 .. jsonb_array_length(items) - 1 LOOP
        elem := items->i;
        IF elem->>'key' = 'tools' THEN
          tools_item := elem;
        END IF;
      END LOOP;

      rebuilt := '[]'::jsonb;
      inserted := false;
      FOR i IN 0 .. jsonb_array_length(items) - 1 LOOP
        elem := items->i;
        IF elem->>'key' = 'tools' THEN
          CONTINUE;
        END IF;
        rebuilt := rebuilt || jsonb_build_array(elem);
        IF elem->>'key' = 'library' AND NOT inserted THEN
          rebuilt := rebuilt || jsonb_build_array(tools_item);
          inserted := true;
        END IF;
      END LOOP;
      IF NOT inserted THEN
        rebuilt := rebuilt || jsonb_build_array(tools_item);
      END IF;

      known := nav->'knownItemKeys';
      IF known IS NULL OR jsonb_typeof(known) <> 'array' THEN
        known := canonical;
      ELSIF NOT known @> '["tools"]'::jsonb THEN
        known := known || '["tools"]'::jsonb;
      END IF;
    END IF;

    UPDATE "OrganizationSettings"
    SET
      general = jsonb_set(
        COALESCE(general, '{}'::jsonb),
        '{navigation}',
        jsonb_build_object(
          'version', 1,
          'items', rebuilt,
          'knownItemKeys', known
        ),
        true
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = rec.id;
    RAISE NOTICE 'placed Tools after Library for organization %', rec.slug;
  END LOOP;
END $$;
