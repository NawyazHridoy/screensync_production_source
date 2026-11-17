-- ============================================================================
-- Migration: 20261116000018_part16_scroll_battles_and_device_splits.sql
-- Purpose: Part 16 Scroll Battles / Friends Duels, User Blocking Configs, and
--          Per-Device Reel Splits with strict Row-Level Security (RLS).
-- Rollback:
--   DROP TABLE IF EXISTS public.scroll_battle_duels CASCADE;
--   DROP TABLE IF EXISTS public.user_blocking_configs CASCADE;
--   DROP TABLE IF EXISTS public.device_reel_splits CASCADE;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.scroll_battle_duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL,
  relationship_tag TEXT NOT NULL DEFAULT 'Bestie',
  friend_display_name TEXT,
  user_daily_reels INTEGER NOT NULL DEFAULT 0 CHECK (user_daily_reels >= 0),
  friend_daily_reels INTEGER NOT NULL DEFAULT 0 CHECK (friend_daily_reels >= 0),
  user_weekly_reels INTEGER NOT NULL DEFAULT 0 CHECK (user_weekly_reels >= 0),
  friend_weekly_reels INTEGER NOT NULL DEFAULT 0 CHECK (friend_weekly_reels >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'DECLINED', 'REMOVED')),
  last_nudged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scroll_battle_duels_invite_code
  ON public.scroll_battle_duels (invite_code);

CREATE INDEX IF NOT EXISTS idx_scroll_battle_duels_user_id
  ON public.scroll_battle_duels (user_id, friend_user_id);

ALTER TABLE public.scroll_battle_duels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scroll_battle_duels_select_own" ON public.scroll_battle_duels;
CREATE POLICY "scroll_battle_duels_select_own"
  ON public.scroll_battle_duels
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "scroll_battle_duels_insert_own" ON public.scroll_battle_duels;
CREATE POLICY "scroll_battle_duels_insert_own"
  ON public.scroll_battle_duels
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "scroll_battle_duels_update_own" ON public.scroll_battle_duels;
CREATE POLICY "scroll_battle_duels_update_own"
  ON public.scroll_battle_duels
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = friend_user_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "scroll_battle_duels_delete_own" ON public.scroll_battle_duels;
CREATE POLICY "scroll_battle_duels_delete_own"
  ON public.scroll_battle_duels
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.scroll_battle_duels FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scroll_battle_duels TO authenticated;

-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_blocking_configs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_block_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reels_allowed_count INTEGER NOT NULL DEFAULT 50 CHECK (reels_allowed_count >= 1 AND reels_allowed_count <= 5000),
  reels_allowed_valid_for_ms BIGINT NOT NULL DEFAULT 86400000,
  block_start_timestamp_ms BIGINT NOT NULL DEFAULT 0,
  block_start_reel_count INTEGER NOT NULL DEFAULT 0,
  cooldown_time_ms BIGINT NOT NULL DEFAULT 1800000,
  hard_block_valid_till_ms BIGINT NOT NULL DEFAULT 0,
  block_pause_expiry_ms BIGINT NOT NULL DEFAULT 0,
  dm_single_reel_exception BOOLEAN NOT NULL DEFAULT TRUE,
  pinned_friend_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_blocking_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocking_configs_own_all" ON public.user_blocking_configs;
CREATE POLICY "user_blocking_configs_own_all"
  ON public.user_blocking_configs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.user_blocking_configs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_blocking_configs TO authenticated;

-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.device_reel_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  local_date DATE NOT NULL,
  app_key TEXT NOT NULL,
  reel_count INTEGER NOT NULL DEFAULT 0 CHECK (reel_count >= 0),
  watch_duration_ms BIGINT NOT NULL DEFAULT 0 CHECK (watch_duration_ms >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, installation_id, local_date, app_key)
);

CREATE INDEX IF NOT EXISTS idx_device_reel_splits_user_date
  ON public.device_reel_splits (user_id, local_date);

ALTER TABLE public.device_reel_splits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_reel_splits_own_all" ON public.device_reel_splits;
CREATE POLICY "device_reel_splits_own_all"
  ON public.device_reel_splits
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.device_reel_splits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_reel_splits TO authenticated;
