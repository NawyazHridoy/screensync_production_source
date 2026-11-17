-- ============================================================================
-- ScreenSync Migration 000016: Device Push Tokens for Modular FCM Push
-- Keeps Supabase Auth & PostgreSQL RLS as the sole backend authority.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'windows', 'macos', 'linux', 'chromeos')),
  fcm_token TEXT NOT NULL,
  app_version TEXT DEFAULT '3.5.0',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_device_push_tokens_user_install UNIQUE (user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_active
  ON public.device_push_tokens (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_platform_active
  ON public.device_push_tokens (platform, is_active);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_push_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.device_push_tokens FROM anon;

DROP POLICY IF EXISTS device_push_tokens_owner_all ON public.device_push_tokens;
CREATE POLICY device_push_tokens_owner_all
  ON public.device_push_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
