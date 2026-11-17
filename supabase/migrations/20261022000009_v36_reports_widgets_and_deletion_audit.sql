-- ============================================================================
-- ScreenSync Migration 009 (v3.6): Weekly Behavioral Reports, Lock Screen
-- Widget Snapshots & Password-Verified Account Deletion Audit Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.weekly_behavioral_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  weekly_reel_velocity NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_reels_7d INTEGER NOT NULL DEFAULT 0,
  total_reel_watch_mins_7d INTEGER NOT NULL DEFAULT 0,
  fast_skip_rate_pct INTEGER NOT NULL DEFAULT 0,
  productive_focus_minutes INTEGER NOT NULL DEFAULT 0,
  focus_to_reel_ratio NUMERIC(6,2) NOT NULL DEFAULT 0,
  week_over_week_delta INTEGER NOT NULL DEFAULT 0,
  letter_grade TEXT NOT NULL DEFAULT 'B',
  takeaway TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, window_end)
);

CREATE TABLE IF NOT EXISTS public.lockscreen_widget_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  unified_reels_count INTEGER NOT NULL DEFAULT 0,
  unified_watch_minutes INTEGER NOT NULL DEFAULT 0,
  daily_reel_goal_minutes INTEGER NOT NULL DEFAULT 60,
  connected_devices_count INTEGER NOT NULL DEFAULT 1,
  widget_headline TEXT NOT NULL DEFAULT '0 Reels Today • All Devices',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, local_date)
);

CREATE TABLE IF NOT EXISTS public.account_deletions_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT 'USER_PASSWORD_VERIFIED_IN_APP',
  password_verified BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_sessions_count INTEGER NOT NULL DEFAULT 0,
  deleted_reels_count INTEGER NOT NULL DEFAULT 0,
  deleted_devices_count INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.weekly_behavioral_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lockscreen_widget_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletions_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_reports_owner_select ON public.weekly_behavioral_reports;
CREATE POLICY weekly_reports_owner_select ON public.weekly_behavioral_reports
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS weekly_reports_owner_write ON public.weekly_behavioral_reports;
CREATE POLICY weekly_reports_owner_write ON public.weekly_behavioral_reports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS lockscreen_widget_owner_select ON public.lockscreen_widget_snapshots;
CREATE POLICY lockscreen_widget_owner_select ON public.lockscreen_widget_snapshots
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS lockscreen_widget_owner_write ON public.lockscreen_widget_snapshots;
CREATE POLICY lockscreen_widget_owner_write ON public.lockscreen_widget_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS account_deletions_audit_owner_select ON public.account_deletions_audit_log;
CREATE POLICY account_deletions_audit_owner_select ON public.account_deletions_audit_log
  FOR SELECT USING (auth.uid() = deleted_user_id);

CREATE OR REPLACE FUNCTION public.delete_user_account_and_all_data(
  target_user_id UUID DEFAULT auth.uid(),
  p_reason TEXT DEFAULT 'USER_PASSWORD_VERIFIED_IN_APP'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid UUID := auth.uid();
  v_sess_cnt INTEGER := 0;
  v_reel_cnt INTEGER := 0;
  v_dev_cnt INTEGER := 0;
BEGIN
  IF caller_uid IS NULL OR (target_user_id IS NOT NULL AND target_user_id <> caller_uid) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ACCOUNT_DELETION';
  END IF;

  SELECT COUNT(*) INTO v_sess_cnt FROM public.screen_usage_sessions WHERE user_id = caller_uid;
  SELECT COUNT(*) INTO v_reel_cnt FROM public.reel_watch_events WHERE user_id = caller_uid;
  SELECT COUNT(*) INTO v_dev_cnt FROM public.device_installations WHERE user_id = caller_uid;

  INSERT INTO public.account_deletions_audit_log (
    deleted_user_id, reason, password_verified, deleted_sessions_count, deleted_reels_count, deleted_devices_count
  ) VALUES (
    caller_uid, COALESCE(p_reason, 'USER_PASSWORD_VERIFIED_IN_APP'), TRUE, v_sess_cnt, v_reel_cnt, v_dev_cnt
  );

  DELETE FROM public.weekly_behavioral_reports WHERE user_id = caller_uid;
  DELETE FROM public.lockscreen_widget_snapshots WHERE user_id = caller_uid;
  DELETE FROM public.sync_dedup_ledger WHERE user_id = caller_uid;
  DELETE FROM public.goal_alert_events WHERE user_id = caller_uid;
  DELETE FROM public.user_achievements WHERE user_id = caller_uid;
  DELETE FROM public.website_usage_sessions WHERE user_id = caller_uid;
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
    'password_verified', true,
    'purged_tables_count', 19
  );
END;
$$;
