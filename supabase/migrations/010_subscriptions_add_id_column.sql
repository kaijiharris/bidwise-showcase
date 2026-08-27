-- 010_subscriptions_add_id_column.sql
--
-- CRITICAL FIX (part 2 of the dashboard lockout) — schema/code drift.
-- (Committed from the festive-bhaskara worktree, where it was authored as
-- "009_subscriptions_add_id_column" but never committed. Renumbered to 010.)
--
-- The web middleware checks access with:
--     supabase.from('subscriptions').select('id')...   (web/middleware.ts)
-- but the PRODUCTION subscriptions table has no `id` column. Its actual columns
-- are: user_id, plan, status, stripe_customer_id, stripe_subscription_id,
-- trial_end, current_period_end, updated_at.
-- So the middleware query returns 42703 "column subscriptions.id does not exist"
-- (HTTP 400), the lookup is treated as "no subscription", and every non-admin is
-- redirected to /pricing — even with a valid active row.
--
-- migration 001 DECLARES subscriptions.id as the PK, but prod was provisioned
-- from a drifted schema that lacks it. This reconciles prod with the documented
-- schema so the deployed middleware's select('id') succeeds.
--
-- Idempotent. Additive. Safe to re-run.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

-- Make it the primary key if the table has none yet. Wrapped so re-runs and
-- pre-existing PKs don't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND contype  = 'p'
  ) THEN
    ALTER TABLE public.subscriptions ADD PRIMARY KEY (id);
  END IF;
END$$;
