-- ============================================================================
-- ScreenSync Migration 008: Category 13 & 14 Security Hardening & Retention RPC
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM anon;
GRANT SELECT ON public.user_subscriptions TO authenticated;

ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS data_retention_days INTEGER DEFAULT 90;

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
  DELETE FROM public.website_usage_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  DELETE FROM public.sound_usage_sessions WHERE user_id = v_uid AND local_date < p_cutoff_date;
  DELETE FROM public.goal_alert_events WHERE user_id = v_uid AND local_date < p_cutoff_date;

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff_date', p_cutoff_date,
    'deleted_sessions', v_deleted_sessions,
    'deleted_reels', v_deleted_reels
  );
END;
$$;
