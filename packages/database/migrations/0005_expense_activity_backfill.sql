-- Every expense becomes an item in its vehicle's activity.
--
-- Until now an expense recorded on the costs page was a row in `expenses` only, so it never
-- appeared in the vehicle's history. From this release the API writes each new expense as an
-- event carrying its cost (linked by `expenses.event_id`), the way services and timeline costs
-- already were. This backfills the ones recorded before: one event per expense with no event,
-- typed from its category, and the expense linked to it.
--
-- Data only, and idempotent: it touches only expenses whose `event_id` is still null, so a
-- second run finds nothing to do.
--
-- `pending` is MATERIALIZED so `gen_random_uuid()` is evaluated once per row — the id inserted
-- into `vehicle_events` and the id written back onto the expense must be the same value.
WITH pending AS MATERIALIZED (
  SELECT
    id AS expense_id,
    gen_random_uuid() AS event_id,
    vehicle_id,
    category,
    description,
    vendor,
    amount_minor,
    currency,
    occurred_at,
    odometer,
    odometer_unit,
    engine_hours,
    source,
    created_by,
    created_at
  FROM expenses
  WHERE event_id IS NULL
),
inserted AS (
  INSERT INTO vehicle_events (
    id,
    vehicle_id,
    event_type,
    title,
    occurred_at,
    odometer,
    odometer_unit,
    engine_hours,
    cost_amount_minor,
    cost_currency,
    provider,
    source,
    created_by,
    created_at,
    updated_at
  )
  SELECT
    event_id,
    vehicle_id,
    -- The same mapping as `eventTypeForCategory` in the API; categories with no event type of
    -- their own become a plain EXPENSE item.
    (CASE category
      WHEN 'PURCHASE' THEN 'PURCHASE'
      WHEN 'MAINTENANCE' THEN 'MAINTENANCE'
      WHEN 'REPAIR' THEN 'REPAIR'
      WHEN 'FUEL' THEN 'FUEL'
      WHEN 'CHARGING' THEN 'CHARGE'
      WHEN 'INSURANCE' THEN 'INSURANCE'
      WHEN 'REGISTRATION' THEN 'REGISTRATION'
      WHEN 'MODIFICATION' THEN 'MODIFICATION'
      WHEN 'PART' THEN 'PART_INSTALLED'
      WHEN 'CLEANING' THEN 'CLEANING'
      ELSE 'EXPENSE'
    END)::event_type,
    description,
    occurred_at,
    odometer,
    odometer_unit,
    engine_hours,
    amount_minor,
    currency,
    vendor,
    source,
    created_by,
    created_at,
    now()
  FROM pending
  RETURNING id
)
UPDATE expenses
SET event_id = pending.event_id
FROM pending
WHERE expenses.id = pending.expense_id;
