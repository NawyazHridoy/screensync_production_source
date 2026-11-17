-- =============================================================================
-- ScreenSync Migration 20261022000013: Category 07 Pass B App Timers & Category Rules Hardening
-- =============================================================================
-- Purpose:
--   1. Replace legacy hardcoded '{"facebook": {"schedule": "Everyday", "minutes": 90}}'::jsonb
--      column default on public.user_settings.app_timers with '{}'::jsonb so newly provisioned
--      accounts never inherit a phantom 90-minute Facebook timer (Fixes F74-B07).
--   2. Add additive deleted (tombstone) and detected_category columns to public.app_category_rules
--      so resetting an app category override to "AUTO" syncs across devices without resurrecting
--      stale remote category rows (Fixes F73-B02 & F73-B03).
--   3. Add performance indexes on public.discovered_apps and public.app_limits for per-user sync.
--
-- Rollback Instructions:
--   ALTER TABLE public.app_category_rules DROP COLUMN IF EXISTS deleted;
--   ALTER TABLE public.app_category_rules DROP COLUMN IF EXISTS detected_category;
--   DROP INDEX IF EXISTS idx_discovered_apps_user_updated;
--   DROP INDEX IF EXISTS idx_app_limits_user_updated;
-- =============================================================================

ALTER TABLE IF EXISTS public.user_settings
  ALTER COLUMN app_timers SET DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.app_category_rules
  ADD COLUMN IF NOT EXISTS detected_category TEXT DEFAULT 'Other',
  ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_discovered_apps_user_updated
  ON public.discovered_apps (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_limits_user_updated
  ON public.app_limits (user_id, updated_at DESC);
