-- ============================================================================
-- ScreenSync Production Migration 0010B: Complete 20-Table RLS Force & Hardening
-- Reference: Part 12A S12.4 (Supabase PostgreSQL RLS & Zero Anonymous Access)
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_profiles', 'device_installations', 'screen_usage_sessions',
    'reel_watch_events', 'user_settings', 'focus_sessions',
    'user_achievements', 'goal_alert_events', 'sync_dedup_ledger',
    'sync_metadata', 'security_alerts', 'app_category_rules',
    'website_usage_sessions', 'sound_usage_sessions', 'tracker_heartbeats',
    'user_subscriptions', 'account_deletion_requests',
    'weekly_behavioral_reports', 'lockscreen_widget_snapshots',
    'account_deletions_audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE IF EXISTS public.%I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users FORCE ROW LEVEL SECURITY;

-- Ensure strict authenticated-only RLS policies on user_profiles (id or user_id = auth.uid())
DROP POLICY IF EXISTS "user_profiles_authenticated_owner_all" ON public.user_profiles;
CREATE POLICY "user_profiles_authenticated_owner_all"
  ON public.user_profiles
  FOR ALL
  TO authenticated
  USING (auth.uid() = id OR auth.uid() = user_id)
  WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

-- Ensure strict authenticated-only RLS policies on all user_id-keyed tables
DO $$
DECLARE
  t TEXT;
  pol_name TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'device_installations', 'screen_usage_sessions',
    'reel_watch_events', 'user_settings', 'focus_sessions',
    'user_achievements', 'goal_alert_events', 'sync_dedup_ledger',
    'sync_metadata', 'security_alerts', 'app_category_rules',
    'website_usage_sessions', 'sound_usage_sessions', 'tracker_heartbeats',
    'user_subscriptions', 'account_deletion_requests',
    'weekly_behavioral_reports', 'lockscreen_widget_snapshots'
  ]
  LOOP
    pol_name := t || '_authenticated_owner_policy';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol_name, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);',
      pol_name, t
    );
  END LOOP;
END $$;

-- Ensure strict authenticated-only RLS policy on account_deletions_audit_log (deleted_user_id = auth.uid())
DROP POLICY IF EXISTS "account_deletions_audit_log_authenticated_owner_policy" ON public.account_deletions_audit_log;
CREATE POLICY "account_deletions_audit_log_authenticated_owner_policy"
  ON public.account_deletions_audit_log
  FOR ALL
  TO authenticated
  USING (auth.uid() = deleted_user_id)
  WITH CHECK (auth.uid() = deleted_user_id);
