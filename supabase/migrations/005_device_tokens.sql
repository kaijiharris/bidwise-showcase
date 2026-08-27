-- ════════════════════════════════════════════════════════════════════════════
-- Migration 005: Device tokens for Expo push notifications
--
-- Stores each user's Expo push token (one per device). The notify-watchlist-
-- matches Edge Function uses these to send push notifications in addition to
-- email when new lead matches are recorded.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token        TEXT        NOT NULL,
  platform     TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (user, token) so re-registering the same device upserts
  -- cleanly instead of stacking duplicates.
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens (user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- Users manage their own device tokens (insert / select / update / delete).
DROP POLICY IF EXISTS "Users manage own device tokens" ON device_tokens;
CREATE POLICY "Users manage own device tokens"
  ON device_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role (used by Edge Function) needs full access to fan out pushes.
DROP POLICY IF EXISTS "Service role full access to device_tokens" ON device_tokens;
CREATE POLICY "Service role full access to device_tokens"
  ON device_tokens FOR ALL
  USING (auth.role() = 'service_role');
