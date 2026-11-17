-- ============================================================================
-- ScreenSync Migration 018: Research Surveys & One-Time Dismissals (Pre-Part-15)
-- Strictly additive & backward-compatible.
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_pending_research_survey(TEXT);
--   DROP TABLE IF EXISTS public.research_survey_dismissals CASCADE;
--   DROP TABLE IF EXISTS public.research_surveys CASCADE;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.research_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  survey_url TEXT NOT NULL CHECK (survey_url ~* '^https://'),
  cta_label TEXT NOT NULL DEFAULT 'Open Google Form',
  dismiss_label TEXT NOT NULL DEFAULT 'Maybe Later',
  is_active BOOLEAN NOT NULL DEFAULT true,
  target_platforms TEXT[] DEFAULT ARRAY['android','ios','web','windows','macos','linux','chromeos'],
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.research_survey_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  survey_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('opened', 'dismissed')),
  platform TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, survey_id)
);

ALTER TABLE public.research_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_surveys FORCE ROW LEVEL SECURITY;

ALTER TABLE public.research_survey_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_survey_dismissals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.research_surveys FROM anon, public;
REVOKE ALL ON public.research_survey_dismissals FROM anon, public;

GRANT SELECT ON public.research_surveys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_survey_dismissals TO authenticated;

DROP POLICY IF EXISTS "authenticated_read_active_research_surveys" ON public.research_surveys;
CREATE POLICY "authenticated_read_active_research_surveys"
  ON public.research_surveys
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "authenticated_manage_own_survey_dismissals" ON public.research_survey_dismissals;
CREATE POLICY "authenticated_manage_own_survey_dismissals"
  ON public.research_survey_dismissals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_pending_research_survey(p_platform TEXT DEFAULT 'web')
RETURNS SETOF public.research_surveys
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT rs.*
  FROM public.research_surveys rs
  WHERE rs.is_active = true
    AND rs.starts_at <= now()
    AND (rs.expires_at IS NULL OR rs.expires_at > now())
    AND (
      rs.target_platforms IS NULL
      OR array_length(rs.target_platforms, 1) IS NULL
      OR lower(COALESCE(p_platform, 'web')) = ANY(rs.target_platforms)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.research_survey_dismissals rsd
      WHERE rsd.user_id = auth.uid()
        AND rsd.survey_id = rs.survey_id
    )
  ORDER BY rs.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_research_survey(TEXT) TO authenticated;
