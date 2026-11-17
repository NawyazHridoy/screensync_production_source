# GEMINI.md — Principal Architect Context Governance Rules for ScreenSync

## Mandatory Pre-Execution Protocol
Before modifying a single line of application, native bridge, or database code in this repository, the AI coding agent (**Google Gemini**) MUST read and adhere to the **6-Document Context Architecture** inside `/docs`:

1. `/docs/01_PRD.md` — Product Requirements Document covering all 24 Post-Pass-25 requirements, 12-Preset Splash Studio, Pure Logo-Only Launch Splash, 5-logo mapping rules (keeping `#accountBrainRowLiveMiniIcon` untouched), and non-goals.
2. `/docs/02_AppFlow.md` — Top-level routed views (`OVERVIEW`, `STATS`, `APP_DETAIL`, `ALL_APPS`, `APP_LIMITS`, `FOCUS`, `ACCOUNT`, standalone `NOTIFICATION_SETTINGS`, standalone `PRIVACY_COMPLIANCE`, standalone `SPLASH_STUDIO`, `CROSS_DEVICE_GUIDE`, `FAQ_VERIFICATION`, `BRAIN_STATE`), deterministic 6-layer back-stack, and capture-phase scroll auto-collapse.
3. `/docs/03_UI_Spec.md` — Design system tokens, pure compact `76px × 86px` `#splashOverlay` rules, `.ss-adaptive-ui-icon` unified `22px`/`24px` `1:1` adaptive 5-logo standard, Liquid Glass sliding pills, and responsive Focus Hero/Card viewport rules.
4. `/docs/04_TRD.md` — Locked tech stack, 5-bundle SHA-256 parity build pipeline (`node build.js`), native Android/iOS bridges, MV3 extension tamper guard, and password-verified account deletion gate.
5. `/docs/05_Schema.md` — Complete PostgreSQL schema (`users`, `device_installations`, `usage_sessions`, `reel_events`, `focus_sessions`, `user_settings`, `weekly_behavioral_reports`, `lockscreen_widget_snapshots`, `account_deletions_audit_log`), RLS policies, and `delete_user_account_and_all_data` RPC.
6. `/docs/06_Plan.md` — Atomic sequential implementation checklist.

## Strict UI Preservation Rule
- Do NOT make any unrequested UI changes. Only modify the exact components, icons, windows, animations, and bugs explicitly specified in `/docs/01_PRD.md`. Leave `#accountBrainRowLiveMiniIcon` and all other existing UI elements 100% untouched.

## Post-Step Synchronization Rule
- After completing any implementation pass or bug fix:
  1. Update `/docs/06_Plan.md` to reflect completed tasks.
  2. Run `node build.js` so `src/index.html`, `www/index.html`, `android/app/src/main/assets/public/index.html`, `ios/App/App/public/index.html`, and `screensync_healthy_device_usage_cross_device_reel_tracker.html` maintain 100% byte-for-byte SHA-256 parity.
  3. Execute `node tests/run_all_tests.js` and ensure all test suites pass with exit code `0`.
