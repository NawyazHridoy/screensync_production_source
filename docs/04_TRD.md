# 04_TRD.md — Technical Requirements Document & Security Architecture

## 1. Locked Technology Stack
- **Web / PWA Core**: Single-file synchronized HTML5/CSS3/ES2022 bundle (`src/index.html`, `src/styles/main.css`, `src/js/app.js`) replicated identically across 5 targets (`src/index.html`, `www/index.html`, `android/app/src/main/assets/public/index.html`, `ios/App/App/public/index.html`, and `screensync_healthy_device_usage_cross_device_reel_tracker.html`) via `node build.js`.
- **Cloud Auth, Database & Realtime**: `@supabase/supabase-js` `^2.49.1` (`SupabaseClientManager`, `SupabaseSyncEngine`) with PostgreSQL Row-Level Security (`auth.uid() = user_id`) and Edge Function (`supabase/functions/delete-account/index.ts`).
- **Native Mobile Bridges**:
  - **Android (API 26–35 / Android 8.0–15)**: `MainActivity.java` (`window.ScreenSyncNativeBridge`), `ScreenSyncAccessibilityService.java`, `UsageEventIngestionEngine.java`, `AppUsageDatabaseHelper.java`, `ReelTrackerWidgetProvider.java`, `ScreenTimeGoalWidgetProvider.java`, `ScreenSyncWidgetUpdater.java`.
  - **iOS / iPadOS (iOS 16.1+)**: `AppDelegate.swift` (`WKScriptMessageHandler` + `ScreenSyncNativeBridge`), `DeviceActivityMonitorExtension.swift`, `ScreenSyncLiveActivityWidget.swift` (`ActivityKit` + `WidgetKit`).
- **Desktop & Browser Companions**:
  - Windows (`ScreenSyncWindowsCompanion.cs`), macOS (`Sources/main.swift`), Linux (`screensync_linux_companion.py`), and Manifest V3 Browser Extension (`platforms/browser-extension/`).

## 2. Security & Privacy Constraints
1. **Mandatory Password-Verified Account Deletion**:
   - `StoreComplianceAndPrivacyManager.deleteAccountAndAllData(userId, options)` rejects any call where `options?.passwordVerified !== true` with `{ ok: false, status: "PASSWORD_VERIFICATION_REQUIRED" }`.
   - `StoreComplianceAndPrivacyManager.verifyAccountPasswordForDeletion(passwordInput)` strictly validates the signed-in user's email and password hash against `BackendDB.data.users` (and `SupabaseClientManager.getActiveDbClient().auth.signInWithPassword` / `POST /api/account/verify-password` when online), with zero permissive length fallbacks.
2. **Extension Heartbeat Tamper Guard (`ExtensionHeartbeatTamperGuard`)**:
   - Tracks heartbeat timestamps from `SCREENSYNC_EXTENSION` and native accessibility hooks (`ScreenSyncAccessibilityService`). If a heartbeat drops past the staleness threshold while a Focus session (`state.focusCountdownActive`) or daily Screen/Reel goal is armed, surfaces `#extensionTamperGuardBanner` and logs a tamper-guard diagnostic event.
3. **Lock Screen Widget Native Sync (`LockScreenWidgetBridge`)**:
   - Computes the unified cross-device daily Reel Count (`computeSnapshot("ALL", "DAY", 0).reelsCount`) and pushes JSON snapshots to `localStorage.getItem("screensync_lockscreen_widget_payload_v1")` and `window.ScreenSyncNativeBridge.updateLockScreenReelWidgetJson(jsonPayload)`.
