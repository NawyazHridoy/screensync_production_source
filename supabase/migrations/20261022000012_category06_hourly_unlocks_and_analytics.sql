-- =============================================================================
-- Migration 012: Category 06 Screen Time Analytics & Hourly Unlocks Persistence
-- =============================================================================
-- Purpose:
--   Adds an additive `hourly_unlocks` JSONB column (24-element integer array)
--   to `public.screen_usage_sessions` so per-hour device unlock distributions
--   survive cloud synchronization and cross-device restoration without falling
--   back to dumping all unlocks into a single session-start hour bucket
--   (Fixes CAT06-04 / C06-06).
--
-- Rollback Instructions:
--   ALTER TABLE public.screen_usage_sessions DROP COLUMN IF EXISTS hourly_unlocks;
-- =============================================================================

ALTER TABLE public.screen_usage_sessions
  ADD COLUMN IF NOT EXISTS hourly_unlocks JSONB DEFAULT NULL;

COMMENT ON COLUMN public.screen_usage_sessions.hourly_unlocks IS
  'Optional 24-element integer array [h0..h23] recording per-hour device unlock counts for the session date and installation.';
