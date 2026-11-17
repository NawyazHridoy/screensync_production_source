# 02_AppFlow.md — State Machine, Navigation Routes & Window Hierarchy

## 1. Top-Level Routed Views (`switchView(viewName)`)
All top-level screens are sibling `<section>` elements inside `<main id="appMainContainer">`:

| Route Key | DOM Section ID | Bottom Nav Tab Index | Parent / Back Target |
|---|---|---|---|
| `OVERVIEW` | `#viewOverview` | `0` (`#bottomNavOverview`) | Root (Android minimize / exit) |
| `ALL_APPS` | `#viewAllAppsBreakdown` | `0` (`#bottomNavOverview`) | `OVERVIEW` |
| `APP_LIMITS` | `#viewAppLimits` | `0` (`#bottomNavOverview`) | `OVERVIEW` |
| `STATS` | `#viewStats` | `1` (`#bottomNavStats`) | `OVERVIEW` |
| `APP_DETAIL` | `#viewAppDetail` | `0` or `1` (`state.appDetailOrigin`) | `state.appDetailOrigin` (`STATS` / `OVERVIEW`) |
| `FOCUS` | `#viewFocus` (`TIMER` / `STATS` sub-views) | `2` (`#bottomNavFocus`) | `OVERVIEW` (or `TIMER` if in `STATS`) |
| `ACCOUNT` | `#viewAccount` | `3` (`#bottomNavAccount`) | `OVERVIEW` |
| `NOTIFICATION_SETTINGS` | `#viewNotificationSettingsWindow` | `3` (`#bottomNavAccount`) | `ACCOUNT` |
| `PRIVACY_COMPLIANCE` | `#viewPrivacyComplianceWindow` | `3` (`#bottomNavAccount`) | `ACCOUNT` |
| `SPLASH_STUDIO` | `#viewSplashAnimationStudio` | `3` (`#bottomNavAccount`) | `ACCOUNT` |
| `CROSS_DEVICE_GUIDE` | `#viewCrossDeviceGuide` | `3` (`#bottomNavAccount`) | `ACCOUNT` |
| `FAQ_VERIFICATION` | `#viewFaqVerificationSuite` | `3` (`#bottomNavAccount`) | `ACCOUNT` |
| `BRAIN_STATE` | `#viewBrainStateVisual` | `3` (`#bottomNavAccount`) | `ACCOUNT` |

## 2. Account Row Action Routing
- `#btnAccountSplashStudioRow` → Invokes `ScreenSyncSplashMotionEngine.openSplashStudioWindow()` → `switchView("SPLASH_STUDIO")`.
- `#btnAccountGoalsFocusRow` → Directly invokes `switchView("FOCUS")` (no inline drawer expansion).
- `#btnAccountBrainStateRow` → Invokes `ScreenSyncWellnessEngine.openBrainStatePage()` → `switchView("BRAIN_STATE")`.
- `#btnAccountNotificationsRow` → Invokes `openNotificationSettingsWindow()` → unhides `#viewNotificationSettingsWindow`, `#accountPermissionsCard`, and `#accountNotificationScheduleCard` and routes via `switchView("NOTIFICATION_SETTINGS")`.
- `#btnAccountPrivacyComplianceRow` → Invokes `StoreComplianceAndPrivacyManager.openPrivacyComplianceWindow()` → unhides `#viewPrivacyComplianceWindow` and `#accountPrivacyComplianceDrawer` and routes via `switchView("PRIVACY_COMPLIANCE")`.
- `#btnDeleteAccountAndAllData` → Exclusively opens `#deleteAccountPasswordConfirmModal`; `#btnConfirmDeleteAccountWithPassword` runs `StoreComplianceAndPrivacyManager.executeVerifiedAccountDeletion(rawPwd)`.

## 3. Deterministic 6-Layer System Back-Stack (`handleSystemBackNavigation`)
1. **Layer 1 (High-Priority System Overlays & Sub-Modals)**: `#brainStateMilestoneOverlay`, `#legalDocumentViewerModal`, `#deleteAccountPasswordConfirmModal`, `#accessibilityDisclosureModal`, `#windDownBedtimeModal`, `#reelDetoxCooldownModal`, `#notificationTimePickerModal`.
2. **Layer 2 (Primary Action Modals)**: `#screenTimeGoalModal`, `#appTimerModal`, `#mainNotificationsModal`, `#authModal` (unwinds `FORGOT` step 2 → step 1 → `LOGIN` → close).
3. **Layer 3 (Header Device Selector Dropdowns)**: `#deviceDropdownMenu`, `#statsDeviceDropdownMenu`.
4. **Layer 4 (Notification Settings Inline Pickers, Standalone Account Windows & Drawers)**:
   - Unwinds open inline wheel panels (`#inlinePickerPanelDailySummary`, `#inlinePickerPanelBreakReminders`, `#inlinePickerPanelQuietHours`, `#inlinePickerPanelDataRetention`) first.
   - Closes `#viewSplashAnimationStudio` (`SPLASH_STUDIO` → `ACCOUNT`), `#viewNotificationSettingsWindow` (`NOTIFICATION_SETTINGS` → `ACCOUNT`), `#viewPrivacyComplianceWindow` (`PRIVACY_COMPLIANCE` → `ACCOUNT`), or open Account accordion drawers (`#accountProfileEditDrawer`, `#accountSyncDetailDrawer`, `#accountDataExportDrawer`, `#accountSubscriptionDrawer`, `#accountHelpSupportDrawer`).
5. **Layer 5 (Sub-Views & Focus Sub-Tabs)**: `APP_DETAIL`, `ALL_APPS`, `APP_LIMITS`, `BRAIN_STATE`, `CROSS_DEVICE_GUIDE`, `FAQ_VERIFICATION`, and `#focusStatsSubView` (`STATS` → `TIMER`).
6. **Layer 6 (Top-Level Tab to Root)**: Non-`OVERVIEW` top-level tabs (`STATS`, `FOCUS`, `ACCOUNT`) return to `OVERVIEW`; at `OVERVIEW`, returns `false` so Android invokes `minimizeAppToHomeScreen()`.

## 4. Capture-Phase Scroll Auto-Collapse (`setupAccountScrollAutoCollapse`)
- Attaches `{ capture: true, passive: true }` scroll listeners on `window`, `document`, `#appRootShell`, and `main`, paired with an `IntersectionObserver` (`threshold: [0, 0.05]`).
- Records the initial scroll offset when an Account drawer opens and collapses the drawer + resets its chevron (`classList.remove("rotate-90")`) as soon as it leaves the viewport (`rect.bottom < 0 || rect.top > window.innerHeight`) or scrolls past the anchor delta threshold.
