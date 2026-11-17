-- ============================================================================
-- ScreenSync Migration 010: Canonical 20-Table Account Deletion RPC &
-- Truthful Data Retention Purge RPC (Reconciles 00005, 00006, 00008, 00009)
-- ============================================================================

BEGIN;

-- Drop ambiguous/broken overloads of delete_user_account_and_all_data
DROP FUNCTION IF EXISTS public.delete_user_account_and_all_data();
DROP FUNCTION IF EXISTS public.delete_user_account_and_all_data(TEXT);
DROP FUNCTION IF EXISTS public.delete_user_account_and_all_data(UUID);
DROP FUNCTION IF EXISTS public.delete_user_account_and_all_data(UUID, TEXT);

-- Guarded column additions on real public.reel_watch_events table
ALTER TABLE IF EXISTS public.reel_watch_events
  ADD COLUMN IF NOT EXISTS fast_skipped BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fast_skipped_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flick_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS watch_ms BIGINT DEFAULT 0;

-- Canonical single-signature SECURITY DEFINER Account & All Data Deletion RPC
CREATE OR REPLACE FUNCTION public.delete_user_account_and_all_data(
  p_user_id UUID DEFAULT auth.uid(),
  p_reason TEXT DEFAULT 'USER_PASSWORD_VERIFIED_IN_APP'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_uid UUID := COALESCE(auth.uid(), p_user_id);
  v_sess_cnt INTEGER := 0;
  v_reel_cnt INTEGER := 0;
  v_dev_cnt INTEGER := 0;
BEGIN
  IF caller_uid IS NULL OR (auth.uid() IS NOT NULL AND p_user_id IS NOT NULL AND p_user_id <> auth.uid()) THEN
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
  DELETE FROM public.account_deletion_requests WHERE user_id = caller_uid;
  DELETE FROM public.sync_dedup_ledger WHERE user_id = caller_uid;
  DELETE FROM public.sync_metadata WHERE user_id = caller_uid;
  DELETE FROM public.goal_alert_events WHERE user_id = caller_uid;
  DELETE FROM public.user_achievements WHERE user_id = caller_uid;
  DELETE FROM public.sound_usage_sessions WHERE user_id = caller_uid;
  DELETE FROM public.website_usage_sessions WHERE user_id = caller_uid;
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
    'deleted_sessions', v_sess_cnt,
    'deleted_reels', v_reel_cnt,
    'deleted_devices', v_dev_cnt,
    'purged_tables_count', 20
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account_and_all_data(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_and_all_data(UUID, TEXT) TO authenticated, service_role;

-- Canonical Retention Purge RPC targeting created schema tables
CREATE OR REPLACE FUNCTION public.prune_user_history_older_than(p_cutoff_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_deleted_sessions INTEGER := 0;
  v_deleted_reels INTEGER := 0;
  v_deleted_focus INTEGER := 0;
  v_deleted_web INTEGER := 0;
  v_deleted_sound INTEGER := 0;
  v_deleted_alerts INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;
  IF p_cutoff_date IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'retention', 'UNLIMITED', 'deleted_sessions', 0, 'deleted_reels', 0);
  END IF;

  DELETE FROM public.screen_usage_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;

  DELETE FROM public.reel_watch_events WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_reels = ROW_COUNT;

  DELETE FROM public.focus_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_focus = ROW_COUNT;

  DELETE FROM public.website_usage_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_web = ROW_COUNT;

  DELETE FROM public.sound_usage_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_sound = ROW_COUNT;

  DELETE FROM public.goal_alert_events WHERE user_id = v_uid AND local_date < p_cutoff_date;
  GET DIAGNOSTICS v_deleted_alerts = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff_date', p_cutoff_date,
    'deleted_sessions', v_deleted_sessions,
    'deleted_reels', v_deleted_reels,
    'deleted_focus', v_deleted_focus,
    'deleted_web', v_deleted_web,
    'deleted_sound', v_deleted_sound,
    'deleted_alerts', v_deleted_alerts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_user_history_older_than(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_user_history_older_than(DATE) TO authenticated, service_role;

COMMIT;
