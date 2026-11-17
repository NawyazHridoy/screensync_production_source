# 05 — Database Schema & Persistence Specification (`docs/05_Schema.md`)

## 1. Local Persistence (`BackendDB` / `screensync_cross_device_db_v5`)
- **Users (`users`)**: `userId`, `name`, `email`, `verified`, `authProvider`, `createdAt` (password hashes persisted separately in `passwordHashesByUser[userId]`).
- **Device Installations (`installationsByUser[userId]`)**: `installationId`, `installationKey`, `userId`, `deviceName`, `osCategory`, `browserName`, `capabilities`, `online`, `lastSyncTime`, `appVersion`, `syncSchemaVersion`.
- **Screen Usage Sessions (`sessionsByUser[userId]`)**: `sessionId`, `userId`, `installationKey`, `osCategory`, `appKey`, `localDate` (`YYYY-MM-DD`), `durationMinutes`, `timesOpened`, `notificationsCount`, `unlocksCount`, `startEpochSec`, `endEpochSec`.
- **Reel & Short-Form Events (`reelEventsByUser[userId]`)**: `eventId`, `userId`, `installationKey`, `osCategory`, `appKey`, `activityType`, `localDate` (`YYYY-MM-DD`), `reelCount`, `watchMinutes`, `timestamp`.
- **Focus Sessions (`focusSessionsByUser[userId]`)**: `sessionId`, `userId`, `localDate`, `durationMinutes`, `completedMinutes`, `completed`, `timeRangeLabel`, `startTimeIso`, `endTimeIso`.
- **Website Sessions (`websiteSessionsByUser[userId]`)**: `sessionId`, `userId`, `installationKey`, `osCategory`, `domain`, `hostname`, `category`, `durationMinutes`, `durationSeconds`, `visitCount`, `localDate`.
- **Sound Exposure Sessions (`soundSessionsByUser[userId]`)**: `sessionId`, `userId`, `installationKey`, `osCategory`, `localDate`, `avgDb`, `peakDb`, `estimatedMaxSpl`, `durationMinutes`, `actualListeningSeconds`, `safeListeningPercentage`.
- **Hourly & Unlock Buckets (`hourlyBucketsByUser[userId]`, `unlockBucketsByUser[userId]`)**: Per-day (`YYYY-MM-DD`) 24-hour activity arrays.
- **Goals, Settings, App Limits & Retention (`settingsByUser[userId]`, `appLimitsByUser[userId]`)**: `screenGoalMinutes`, `dailyGoalMinutes`, `dataRetentionDays` (`30`, `60`, `90`, `180`, `365`, `0`), `designStyle`, `appTheme`, `graphDisplayStyle`, `appTimers`, `notificationSchedule`, `focusProfiles`.
- **Retention & Deletion Ledgers (`purgedRecordIdsByUser[userId]`, `dedupLog`, `pendingCloudRetentionPrunes`, `pendingCloudAccountDeletions`, `accountDeletionRequests`, `accountDeletionsLog`)**: Tombstone tracking, offline prune/deletion queues, and SHA-256 pseudonymized deletion audit log.

## 2. Cloud Schema (Supabase PostgreSQL — 20 User Tables + Audit Log with RLS `auth.uid() = user_id`)
1. `public.users` (`id = auth.uid()`)
2. `public.user_settings` (`user_id = auth.uid()`)
3. `public.device_installations` (`user_id = auth.uid()`)
4. `public.screen_usage_sessions` (`user_id = auth.uid()`)
5. `public.reel_watch_events` (`user_id = auth.uid()`)
6. `public.focus_sessions` (`user_id = auth.uid()`)
7. `public.website_usage_sessions` (`user_id = auth.uid()`)
8. `public.sound_usage_sessions` (`user_id = auth.uid()`)
9. `public.hourly_usage_buckets` (`user_id = auth.uid()`)
10. `public.unlock_QuickCheck_buckets` (`user_id = auth.uid()`)
11. `public.app_category_rules` (`user_id = auth.uid()`)
12. `public.app_daily_timers` (`user_id = auth.uid()`)
13. `public.notification_schedules` (`user_id = auth.uid()`)
14. `public.notification_inbox` (`user_id = auth.uid()`)
15. `public.user_achievements` (`user_id = auth.uid()`)
16. `public.security_alerts` (`user_id = auth.uid()`)
17. `public.goal_alert_events` (`user_id = auth.uid()`, indexed by `goal_period_date`)
18. `public.sync_dedup_ledger` (`user_id = auth.uid()`)
19. `public.sync_metadata` (`user_id = auth.uid()`)
20. `public.account_deletion_requests` (`user_id = auth.uid()`)
- **Additional Telemetry & Store-Compliance Tables**:
  - `public.weekly_behavioral_reports` (`user_id = auth.uid()`)
  - `public.lockscreen_widget_snapshots` (`user_id = auth.uid()`)
  - `public.tracker_heartbeat_telemetry` (`user_id = auth.uid()`)
  - `public.account_deletions_audit_log` (stores `deleted_user_id`, `deleted_user_hash` SHA-256, `reason`, `deleted_at`)
- **Server-Side RPCs**:
  - `public.prune_user_history_older_than(p_cutoff_date DATE)` / `public.prune_user_history_older_than(p_days INTEGER, p_cutoff_date DATE)`
  - `public.delete_user_account_and_all_data(p_user_id UUID, p_reason TEXT, target_user_id UUID, p_password_verified BOOLEAN)`
  - `public.delete_current_user_account()`
