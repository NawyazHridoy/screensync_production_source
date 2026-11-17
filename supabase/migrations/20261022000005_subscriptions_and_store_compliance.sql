-- ============================================================================
-- ScreenSync Production Database Migration 005: Real-Time Paid Subscriptions,
-- Cross-Store Receipt Entitlement Sync & Store-Compliant Account/Data Deletion
-- Supabase Project: https://ldephpgydnsovhlkuzbe.supabase.co
-- Migration File: supabase/migrations/20261022000005_subscriptions_and_store_compliance.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. public.user_subscriptions (Real-Time Cross-Device Subscription Entitlement)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_id IN ('FREE', 'PRO_MONTHLY', 'PRO_YEARLY', 'PRO_LIFETIME')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  store_provider TEXT NOT NULL DEFAULT 'WEB_STRIPE' CHECK (store_provider IN ('GOOGLE_PLAY_BILLING', 'APPLE_STOREKIT', 'MICROSOFT_STORE', 'WEB_STRIPE', 'PROMO_GRANT')),
  product_sku TEXT NOT NULL DEFAULT 'io.screensync.wellness.free',
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  billing_interval TEXT NOT NULL DEFAULT 'NONE' CHECK (billing_interval IN ('NONE', 'MONTH', 'YEAR', 'LIFETIME')),
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  trial_ends_at TIMESTAMPTZ NULL,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NULL,
  store_order_id TEXT NULL,
  store_purchase_token TEXT NULL,
  entitlements JSONB NOT NULL DEFAULT '{"unlimitedDevices":false,"cloudRealtimeSync":true,"brainStateHistoryDays":7,"advancedFocusAnalytics":false,"priorityExportBackup":false}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status_period
  ON public.user_subscriptions (status, current_period_end);

DROP TRIGGER IF EXISTS trg_user_subscriptions_updated_at ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_updated_at
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;

DROP POLICY IF EXISTS user_subscriptions_own ON public.user_subscriptions;
CREATE POLICY user_subscriptions_own
  ON public.user_subscriptions
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. public.account_deletion_requests (Google Play & Apple App Store Compliance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'USER_REQUESTED_IN_APP',
  deleted_tables_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.account_deletion_requests TO authenticated;

DROP POLICY IF EXISTS account_deletion_requests_insert_own ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_insert_own
  ON public.account_deletion_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. RPC: public.delete_user_account_and_all_data()
--    Complies with Google Play User Data Deletion Policy & Apple Guideline 5.1.1(v)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_account_and_all_data(p_reason TEXT DEFAULT 'USER_REQUESTED_IN_APP')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sessions_deleted INTEGER := 0;
  v_reels_deleted INTEGER := 0;
  v_devices_deleted INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to delete account data';
  END IF;

  DELETE FROM public.screen_usage_sessions WHERE user_id = v_uid;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

  DELETE FROM public.reel_watch_events WHERE user_id = v_uid;
  GET DIAGNOSTICS v_reels_deleted = ROW_COUNT;

  DELETE FROM public.device_installations WHERE user_id = v_uid;
  GET DIAGNOSTICS v_devices_deleted = ROW_COUNT;

  DELETE FROM public.focus_sessions WHERE user_id = v_uid;
  DELETE FROM public.user_settings WHERE user_id = v_uid;
  DELETE FROM public.security_alerts WHERE user_id = v_uid;
  DELETE FROM public.sync_metadata WHERE user_id = v_uid;
  DELETE FROM public.app_category_rules WHERE user_id = v_uid;
  DELETE FROM public.website_usage_sessions WHERE user_id = v_uid;
  DELETE FROM public.sound_usage_sessions WHERE user_id = v_uid;
  DELETE FROM public.tracker_heartbeats WHERE user_id = v_uid;
  DELETE FROM public.user_subscriptions WHERE user_id = v_uid;
  DELETE FROM public.user_profiles WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'userId', v_uid,
    'deletedSessions', v_sessions_deleted,
    'deletedReelEvents', v_reels_deleted,
    'deletedDevices', v_devices_deleted,
    'deletedAt', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_account_and_all_data(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account_and_all_data(TEXT) TO authenticated;

COMMIT;
