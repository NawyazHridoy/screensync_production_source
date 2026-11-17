# ScreenSync — Stage 1 Recon & Validation Contract (`/docs/recon.md`)

**Target Project:** `ScreenSync (io.screensync.wellness)` — v3.5.0 (Build 35)
**Scope:** Part 00 Master Execution Roadmap, Step 0.1 CI Packaging Restoration, Step 0.2 Android/iOS Compile-Break Hotfixes, and Starter Fix Packages A (Cat 12 Auth/Server Fail-Closed), B (Cat 13 Account Deletion & Retention Purge), and C (Cat 03/04/06 Counting Integrity).

## 1. Audited Pain Points & Surface Contracts
1. **Step 0.1 CI Packaging Blocker (`.github/workflows/build.yml`)**:
   - *Symptom*: Missing from shipped ZIP, causing `tests/run_all_tests.js` to abort at Pass 2 (`AssertionError: Pass 2: .github/workflows/build.yml must exist`).
   - *Contract*: Restore `.github/workflows/build.yml` pinning JDK 17, Node.js 24, and Gradle 8.5 without destructive `rm -rf android` or `capacitor/cli add android` commands.
2. **Step 0.2 Native Android Java & iOS Swift Compile Breaks**:
   - `MainActivity.java`: Missing `decryptWithKeystore(String)` implementation + plaintext session written to `"persisted_auth_session_v2"`; undeclared `areNotificationsAllowed()`; void return type on `openPermissionSettings` assigned to `boolean launched`; missing `WebSettings.setTextZoom` in `configureWebView` and `onConfigurationChanged`.
   - `ScreenSyncAccessibilityService.java`: Undeclared `lastWidgetBroadcastElapsedMs` field; undeclared `SHORT_FORM_PACKAGES` reference; missing `com.twitter.android` and `com.reddit.frontpage` in `SUPPORTED_PACKAGES`.
   - `ios/App/App/AppDelegate.swift`: Missing `#if canImport(HealthKit) import HealthKit #endif` guard.
3. **Starter Fix A — Category 12 Auth & Sync Server Fail-Closed**:
   - `server/sync_server.js`: `POST /api/account/verify-password` previously returned `{ verified: true }` when no stored hash existed and accepted plaintext passwords; `/api/account/delete` skipped auth verification when the `Authorization` header was omitted; added `REDIS_ENABLED=true` and `RedisAlwaysOnCache` write-through mirror.
   - `src/js/app.js`: `ingestCompanionTick`, `recordExtensionHeartbeat`, and the `window` `message` listener lacked foreign-`userId` rejection, future-timestamp skew rejection, per-installation monotonic timestamp validation, `elapsedSeconds` clamping (`[0, 300]`), `ev.origin` verification, and `trackerHeartbeatsByInstallation` stamping.
4. **Starter Fix B — Category 13 Account Deletion & Retention Purge**:
   - `supabase/migrations/20261022000010_reconcile_deletion_and_retention_rpcs.sql`: Additive corrective migration dropping ambiguous `delete_user_account_and_all_data` overloads and creating a single canonical `SECURITY DEFINER` RPC deleting from all 20 real schema tables + replacing `prune_user_history_older_than(DATE)` to delete from the 6 real dated history tables (`screen_usage_sessions`, `reel_watch_events`, `focus_sessions`, `website_usage_sessions`, `sound_usage_sessions`, `goal_alert_events`).
   - `supabase/functions/delete-account/index.ts`: Enforces `SUPABASE_SERVICE_ROLE_KEY` presence (`500` if missing), awaits RPC and checks `admin.deleteUser` errors (`500` on error), passes `p_reason`, and supports CORS `OPTIONS`.
   - `src/js/app.js`: Records purged record tombstones in `BackendDB.data.purgedRecordIdsByUser` during `purgeDataOlderThan` so `mergeRemoteRecordsIntoLocal` skips resurrected rows, and purges `offlineQueue`, `authSessions`, `trackerHeartbeatsByInstallation`, `notificationInboxByUser`, and `purgedRecordIdsByUser` on account deletion.
5. **Starter Fix C — Categories 03, 04 & 06 Counting Integrity**:
   - `src/js/app.js`: Revisit-aware LRU (`getLruEntry`, `recordFingerprintInLru`) tracking `interveningDistinctCount` so backward swipes after viewing other reels count `+1` and flush watch time; `isPlaying === false` pause guard; `ScreenTimeAggregator.computeUnionMinutes` and `reconcileLegacyMinutes`; idempotent unlock delta reconciliation on native raw-event re-ingestion and aggregate backfill; historical fixture date anchoring in `StreaksAndChallengesEngine.computeStreakSummary`.
   - `UsageEventIngestionEngine.java`, `AppUsageDatabaseHelper.java`, `ScreenSyncAccessibilityService.java`: Removed destructive `dbHelper.flushAllUsageTables()` on permission loss (`D-3`); added `reel_outbox_events` SQLite outbox table; updated `ScreenSyncAccessibilityService` with revisit-aware LRU, interaction-age idle clamp, and positional `TIER_C_CANVAS|INDEX_FALLBACK` signature.

## Part 12A Reconnaissance Update (2026-11-13)
- **[Certain]** Audited Category 12 (`S12.1`–`S12.6` and `C12-01`–`C12-43`) across `src/index.html`, `src/styles/main.css`, `src/js/app.js`, `server/sync_server.js`, `supabase/migrations/`, `firestore.rules`, `platforms/`, and `extension/`.
- **[Certain]** Synchronized 5-bundle SHA-256 post-Part-12A: `ec24cc0772f5cc8ab64e02c04205db808ac0824aeff445cd3bc2346fd9894398`.

## Part 01A Reconnaissance & RuntimeConfig Key->Consumer Contract (2026-11-14)
- **[Certain]** Audited Category 01 (`Features 1.1–1.6`, `ISS-C01-01`..`ISS-C01-16`, `C1-01`..`C1-17`) across `src/index.html`, `src/styles/main.css`, `src/js/app.js`, `src/sw.js`, `src/manifest.webmanifest`, `config/screensync.config.json`, `scripts/sync-web-assets.js`, and `platforms/browser-extension/content_bridge.js`.

### Canonical `config/screensync.config.json` Key -> Runtime Consumer Table (`C1-09` / `AC-09c`)
| Config Key | Default Value | Primary Runtime Consumer(s) in `src/js/app.js` / Build |
| :--- | :--- | :--- |
| `appVersion` / `version` | `"3.5.0"` | `RuntimeConfigLoader`, `AppStoreUpdateManager._compareSemver()`, `src/sw.js` (`APP_VERSION`) |
| `appBuild` / `buildNumber` | `35` | `RuntimeConfigLoader`, `<html data-app-build="35">` |
| `defaultSyncPort` / `defaultSyncHost` | `3001` / `"127.0.0.1"` | `RuntimeConfigLoader`, `SupabaseSyncEngine`, local sync server endpoint resolution |
| `reelMinDwellMs` | `1200` | `RuntimeConfigLoader`, `ReelTrackingEngine` (`REEL_MIN_DWELL_MS` threshold) |
| `scrollSettleDebounceMs` | `300` | `RuntimeConfigLoader`, `ReelTrackingEngine` (`SCROLL_SETTLE_DEBOUNCE_MS` threshold) |
| `idleThresholdSeconds` | `300` | `RuntimeConfigLoader`, `ScreenTimeAggregator` / idle session detector |
| `soundHarmfulDbThreshold` | `75` | `RuntimeConfigLoader`, `SoundExposureEngine` harmful dB alert threshold |
| `toastDefaultDurationMs` | `4500` | `RuntimeConfigLoader`, `ToastManager.show()` / `showToast()` default duration |
| `splashMinVisibleMs` | `400` | `RuntimeConfigLoader`, `DOMContentLoaded` launch splash minimum visibility floor |
| `splashMaxVisibleMs` | `8000` | `RuntimeConfigLoader`, `DOMContentLoaded` launch splash watchdog failsafe ceiling |
| `featureFlags.storeReleaseGateEnabled` | `false` | `RuntimeConfigLoader`, `AppStoreUpdateManager.checkAndPromptDailyUpdate()` gate |
| `featureFlags.webPreviewBannerEnabled` | `true` | `RuntimeConfigLoader`, `WebPreviewBannerController.init()` gate |
| `supabase.url` / `supabase.publishableKey` / `supabase.storageKey` | Supabase project config | `RuntimeConfigLoader`, `SUPABASE_CONFIG`, `SupabaseClientManager.init()`, `SupabaseSyncEngine` |
| `sync.autoSyncIntervalMs` | `30000` | `RuntimeConfigLoader`, `SupabaseSyncEngine` background sync interval |
| `sync.companionPollIntervalMs` | `10000` | `RuntimeConfigLoader`, desktop companion polling scheduler |
| `sync.localSyncServerUrl` / `sync.localSyncServerFallbackUrl` | `:3001` / `:8788` | `RuntimeConfigLoader`, `SupabaseSyncEngine`, `src/sw.js` loopback exclusions |
| `sync.desktopCompanionUrl` / `sync.desktopCompanionFallbackUrl` | `:19540` / `:17935` | `RuntimeConfigLoader`, desktop companion poller, `src/sw.js` loopback exclusions |
| `supportedShortFormPackages` | 23 package IDs | `RuntimeConfigLoader`, `ReelTrackingEngine`, Android/iOS package classifiers |

## Part 15 Reconnaissance & Security Surface Mapping (2026-11-17)
- **[Certain]** Audited Android R8/ProGuard (`android/app/build.gradle`, `android/app/proguard-rules.pro`), Google PairIP (`AndroidManifest.xml`, `ScreenSyncSecureApplication.java`), 7-Layer `NativeAntiTamperGuard.java`, `StringVault.java`, `CrossPlatformSecurityGuard` (`src/js/app.js`), `IosSecurityIntegrityGuard` (`ios/App/App/AppDelegate.swift`), macOS Hardened Runtime (`platforms/macos/`), Windows Rust/C# companions (`platforms/windows-companion/`, `platforms/windows/`), Linux companion (`platforms/linux/screensync_linux_companion.py`), and Chrome Web Store MV3 Extension (`platforms/browser-extension/`).
- **[Certain]** Synchronized 5-bundle SHA-256 post-Part-15: `3a7a6afaaa6962a82d37cad2fd99098b985b0262fc19bd8f3f488cf5a465efd8` (`85 / 85` automated test suites passing).
