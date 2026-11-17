-- Category 08 Pass B: Goal History, Goal Alert Deliveries, Timestamped Goal Sync & Realtime Publication
-- Additive & backward-compatible migration

-- 1. Create public.goal_history for effective-dated goal thresholds & enabled flags
CREATE TABLE IF NOT EXISTS public.goal_history (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  screen_goal_minutes INTEGER NOT NULL CHECK (screen_goal_minutes >= 15 AND screen_goal_minutes <= 960),
  reel_goal_minutes INTEGER NOT NULL CHECK (reel_goal_minutes >= 5 AND reel_goal_minutes <= 480),
  screen_goal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reel_goal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, effective_from)
);

ALTER TABLE public.goal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.goal_history FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goal_history' AND policyname = 'goal_history_user_isolation'
  ) THEN
    CREATE POLICY goal_history_user_isolation ON public.goal_history
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 2. Create public.goal_alert_deliveries for per-installation alert receipts
CREATE TABLE IF NOT EXISTS public.goal_alert_deliveries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISPLAYED',
  channel TEXT NULL,
  presented_at_ms BIGINT NULL,
  dismissed_at_ms BIGINT NULL,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_id, installation_id)
);

ALTER TABLE public.goal_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_alert_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.goal_alert_deliveries FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'goal_alert_deliveries' AND policyname = 'goal_alert_deliveries_user_isolation'
  ) THEN
    CREATE POLICY goal_alert_deliveries_user_isolation ON public.goal_alert_deliveries
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 3. Add per-goal timestamp columns on public.user_settings for mergeGoalSettings()
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS screen_goal_updated_at BIGINT NULL,
  ADD COLUMN IF NOT EXISTS reel_goal_updated_at BIGINT NULL;

-- 4. Add origin_installation_id & allow multiple goal thresholds per day on public.goal_alert_events
ALTER TABLE public.goal_alert_events
  ADD COLUMN IF NOT EXISTS origin_installation_id TEXT NULL;

ALTER TABLE public.goal_alert_events
  DROP CONSTRAINT IF EXISTS uq_goal_alert_events_period;

ALTER TABLE public.goal_alert_events
  ADD CONSTRAINT uq_goal_alert_events_period UNIQUE (user_id, goal_type, goal_period_date, goal_minutes);

-- 5. Idempotently add watched tables to supabase_realtime publication
DO $$
DECLARE
  tbl TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY ARRAY['goal_alert_events', 'goal_alert_deliveries', 'user_settings', 'focus_sessions'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      END IF;
    END LOOP;
  END IF;
END $$;
