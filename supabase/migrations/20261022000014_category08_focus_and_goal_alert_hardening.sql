-- Category 08 Pass A: Focus Sessions & Goal Alert Events Hardening (Additive & Backward-Compatible)
-- 1. Widen focus_sessions.planned_minutes CHECK to 1..240 (supports 5m/15m Pomodoro breaks & 5..240m spec range)
ALTER TABLE public.focus_sessions
  DROP CONSTRAINT IF EXISTS focus_sessions_planned_minutes_check;

ALTER TABLE public.focus_sessions
  ADD CONSTRAINT focus_sessions_planned_minutes_check CHECK (planned_minutes >= 1 AND planned_minutes <= 240);

ALTER TABLE public.focus_sessions
  DROP CONSTRAINT IF EXISTS focus_sessions_completed_minutes_check;

ALTER TABLE public.focus_sessions
  ADD CONSTRAINT focus_sessions_completed_minutes_check CHECK (completed_minutes >= 0 AND completed_minutes <= 240);

-- 2. Add focus session metadata columns (mode, phase_index, cycle_id, distraction counters, end_reason)
ALTER TABLE public.focus_sessions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'SIMPLE',
  ADD COLUMN IF NOT EXISTS phase_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycle_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS distraction_warnings INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distraction_overrides INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS end_reason TEXT NULL;

-- 3. Add goal_alert_events status and dismissed_at_ms columns for cross-device dismissal sync
ALTER TABLE public.goal_alert_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS dismissed_at_ms BIGINT NULL;
