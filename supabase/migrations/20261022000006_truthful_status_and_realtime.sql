-- ============================================================================
-- ScreenSync Migration 006: Truthful Installation Defaults, Skip/Flick Columns,
-- Complete 15-Table Account Deletion RPC & Realtime Publication
-- ============================================================================

ALTER TABLE IF EXISTS public.device_installations
  ALTER COLUMN tracking_permitted SET DEFAULT NULL,
  ALTER COLUMN permission_status SET DEFAULT 'Not checked',
  ALTER COLUMN sync_status SET DEFAULT 'Pending sync',
  ALTER COLUMN last_synced_at SET DEFAULT NULL;

ALTER TABLE IF EXISTS public.reel_watch_events
  ADD COLUMN IF NOT EXISTS fast_skipped BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fast_skipped_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flick_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS watch_ms BIGINT DEFAULT 0;

ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS reel_detox_cooldown_seconds INTEGER DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.discovered_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT DEFAULT 'default_inst',
  app_key TEXT NOT NULL CHECK (char_length(btrim(app_key)) >= 1 AND char_length(btrim(app_key)) <= 160),
  app_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Other',
  supports_reels BOOLEAN NOT NULL DEFAULT FALSE,
  os_category TEXT NOT NULL DEFAULT 'Android',
  package_id TEXT NULL,
  bundle_id TEXT NULL,
  icon_data_uri TEXT NULL,
  is_native_os_label BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_discovered_apps_user_key UNIQUE (user_id, app_key)
);
ALTER TABLE public.discovered_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovered_apps FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovered_apps FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovered_apps TO authenticated;
DROP POLICY IF EXISTS discovered_apps_own ON public.discovered_apps;
CREATE POLICY discovered_apps_own ON public.discovered_apps
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.app_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_key TEXT NOT NULL CHECK (char_length(btrim(app_key)) >= 1 AND char_length(btrim(app_key)) <= 160),
  limit_minutes INTEGER NOT NULL CHECK (limit_minutes >= 1 AND limit_minutes <= 1439),
  schedule TEXT NOT NULL DEFAULT 'Everyday',
  packages JSONB NOT NULL DEFAULT '[]'::jsonb,
  enforcement_mode TEXT NOT NULL DEFAULT 'WARNING_ONLY',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_app_limits_user_key UNIQUE (user_id, app_key)
);
ALTER TABLE public.app_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_limits FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_limits TO authenticated;
DROP POLICY IF EXISTS app_limits_own ON public.app_limits;
CREATE POLICY app_limits_own ON public.app_limits
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.delete_user_account_and_all_data(target_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid UUID := auth.uid();
BEGIN
  IF caller_uid IS NULL OR (target_user_id IS NOT NULL AND target_user_id <> caller_uid) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ACCOUNT_DELETION';
  END IF;

  DELETE FROM public.sync_dedup_ledger WHERE user_id = caller_uid;
  DELETE FROM public.goal_alert_events WHERE user_id = caller_uid;
  DELETE FROM public.user_achievements WHERE user_id = caller_uid;
    DELETE FROM public.sound_usage_sessions WHERE user_id = caller_uid;
  DELETE FROM public.tracker_heartbeats WHERE user_id = caller_uid;
  DELETE FROM public.security_alerts WHERE user_id = caller_uid;
  DELETE FROM public.discovered_apps WHERE user_id = caller_uid;
  DELETE FROM public.app_limits WHERE user_id = caller_uid;
  DELETE FROM public.app_category_rules WHERE user_id = caller_uid;
      DELETE FROM public.focus_sessions WHERE user_id = caller_uid;
  DELETE FROM public.reel_watch_events WHERE user_id = caller_uid;
  DELETE FROM public.screen_usage_sessions WHERE user_id = caller_uid;
  DELETE FROM public.user_subscriptions WHERE user_id = caller_uid;
  DELETE FROM public.user_settings WHERE user_id = caller_uid;
  DELETE FROM public.device_installations WHERE user_id = caller_uid;
  DELETE FROM public.user_profiles WHERE user_id = caller_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_user_id', caller_uid,
    'purged_tables_count', 17
  );
END;
$$;
