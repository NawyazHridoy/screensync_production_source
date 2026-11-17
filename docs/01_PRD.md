# 01_PRD.md — Product Requirements Document (ScreenSync Post-Pass-25 v3.7)

## 1. Core Problem & Vision
Modern knowledge workers, students, and creators operate across 3–5 screens daily (Android, iOS/iPadOS, Windows, macOS, Linux, and Chromium/Firefox browsers). Existing digital wellbeing tools are siloed to a single operating system, blind to in-app short-form video velocity (Instagram Reels, YouTube Shorts, TikTok, Facebook Reels, Snapchat Spotlight), and prone to alert fatigue.

**ScreenSync — Healthy Device Usage & Cross-Device Reel Tracker** solves cross-device doomscrolling fragmentation, notification fatigue, and unverified self-regulation friction through unified screen-time interval union math, 6-state short-form video dwell tracking, real-time 3D brain-vitality feedback, and frictionless focus enforcement.

## 2. Target Personas
- **Students & Researchers**: Need distraction-free deep study sessions (20–180m) with automatic suppression of non-critical wellness prompts and live Reel Watch Time limits.
- **Knowledge Workers & Engineers**: Switch between phone and desktop browsers; require unified interval-union screen time (`All Devices`) without double-counting overlapping usage.
- **Creators & Multi-Device Power Users**: Need real-time visibility into short-form scroll velocity (`reels/hr`), lock-screen friction widgets, customizable launch splash animations, and Sunday behavioral report cards.

## 3. MVP & All 24 Post-Pass-25 User Stories
### A. Splash Screen & Motion Studio (Items 1–7)
1. **12 Splash Screen Animations Integrated**: `ScreenSyncSplashMotionEngine` supports all 12 presets: `screensync_morph` (**1. ScreenSync Display Bridge**), `black_eclipse` (**2. Pure Black Eclipse**), `white_inkflow` (**3. Pure White Ink-Flow**), `sync_radar` (**4. Sync Wave Radar**), `convergence` (**5. Dual Ribbon Lock**), `neon_trace` (**6. Neon Contour Trace**), `gyro_orbit` (**7. 3D Gyro Orbit & Snap**), `prism_fuse` (**8. Prism Trio Fuse**), `ripple_drop` (**9. Elastic Ripple Drop**), `quantum` (**10. Quantum Vortex**), `liquid` (**11. Liquid Aurora Wave**), and `minimal` (**12. Titanium Micro-Spring**).
2. **Default Splash & Zero Halo Default**: **"ScreenSync Display Bridge"** (`screensync_morph`) is the default splash animation with **"FX & Halo Intensity" default set to `0` (`0%`)**.
3. **Account Page "Splash Screen & Launch Animation" Row & Dedicated Window**: Tapping `#btnAccountSplashStudioRow` in `#viewAccount` opens the dedicated top-level window `#viewSplashAnimationStudio` via `switchView("SPLASH_STUDIO")` where users live-preview, select, and persist their launch splash animation and adjust **"FX & Halo Intensity"**.
4. **Section 3 Branding/Scale Removal**: Section `"3. App Icon Scale & ScreenSync Branding"` is completely omitted from the splash studio UI and code so logo sizing stays compact and standard, preserving **ONLY** the `"FX & Halo Intensity"` slider (`#sliderSplashHaloIntensity`, `default: 0`).
5. **Pure Launch Splash Rule (`#splashOverlay`)**: When opening the app (`#splashOverlay`), **ONLY the compact logo and its animation** are visually displayed — zero text, zero buttons, zero spinners, and zero progress bars.
6. **Compact Logo Size (`76px × 86px`) & Zero End-Box Artifact**: Enforces a compact `76px × 86px` logo rig (`.splash-logo-mask`, `.ss-splash-logo-rig`) with transparent background, no border, no box-shadow, and no CSS filter box so zero rectangular artifact appears over the logo at the end of the animation.
7. **Nanosecond-Smooth Transitions**: Fixes **Quantum Vortex** (`quantum`) with continuous `smoothstep(0.38, 0.68, p)` cross-dissolve interpolation so particles never jump abruptly to the solid logo, paired with sub-millisecond `requestAnimationFrame` delta smoothing across all splash and app transitions.

### B. Responsive Focus Layout & Guide Notification Contrast (Items 8–10)
8. **Focus Hero Scene Responsive Scaling**: `#focusHeroSceneCard` (`height: clamp(220px, 28vw, 320px)`) and its inner SVG (`preserveAspectRatio="xMidYMid slice"`) scale edge-to-edge across Phone, Tablet, Laptop, and PC with zero empty side bars.
9. **Focus Timer & Stats Cards Responsive Scaling**: `#focusTimerSubView`, `#focusDurationPickerCard`, `#focusActiveCountdownCard`, and `#focusStatsSubView` scale fluidly across Phone, Tablet, Laptop, and PC viewports.
10. **High-Contrast Guide/Permission Notification Banner (`#toastBanner`)**: Uses a high-contrast dark glass surface (`rgba(7, 19, 43, 0.97)`, border `rgba(56, 189, 248, 0.48)`, `#FFFFFF` title, `#E2E8F0` body) across all themes and modes.

### C. Account Standalone Windows, Password-Verified Deletion & Auto-Collapse (Items 11–16)
11. **Bug 1 (Standalone Privacy Policy, Terms & Account Deletion Window)**: `#viewPrivacyComplianceWindow` is a top-level `<section>` sibling of `#viewAccount` routed via `switchView("PRIVACY_COMPLIANCE")` with zero inline sub-section in Account.
12. **Bug 2 (Mandatory Password-Verified Account Deletion)**: `#btnDeleteAccountAndAllData` exclusively opens `#deleteAccountPasswordConfirmModal`; `StoreComplianceAndPrivacyManager.deleteAccountAndAllData(userId, options)` requires `options.passwordVerified === true` and verifies the typed password against the user's registered email and password hash in `BackendDB.data.users` and `SupabaseClientManager` before deletion.
13. **Bug 3 (Direct 1-Tap Jump from Goals & Focus to Focus Page)**: `#btnAccountGoalsFocusRow` navigates directly to `switchView("FOCUS")` while keeping `#accountGoalsQuickDrawer` permanently hidden (`display: none !important`).
14. **Bug 4 (Standalone Notification Settings Window)**: `#viewNotificationSettingsWindow` is a top-level `<section>` sibling of `#viewAccount` routed via `switchView("NOTIFICATION_SETTINGS")` with zero inline sub-section in Account.
15. **Bug 5 (Phone Mode Cross-Device Guide Header Pill Alignment)**: `#crossDeviceGuideHelpBadge` (`.ss-guide-header-pill`) centers `"Help & Support"` on a single line (`inline-flex items-center justify-center text-center whitespace-nowrap shrink-0`).
16. **Bug 6 (Account Sub-Sections Auto-Collapse on Scroll)**: `setupAccountScrollAutoCollapse()` automatically collapses any open Account sub-section and resets its chevron (`rotate-90`) when scrolled off-screen.

### D. Authoritative 5-Logo Adaptive System (Item 17)
17. **Bug 7 (5 Equal-Sized Adaptive Reference Logos)**: Enforces identical dimensions (`22px` mobile / `24px` desktop, `1:1` aspect ratio, `.ss-adaptive-ui-icon`) and Dark/Light/Theme adaptability ONLY across the 5 target slots in `#bottomNavBarContainer` and `#focusSubTabBar` (leaving `#accountBrainRowLiveMiniIcon` 100% untouched):
    - **Home (`#bottomNavOverview`)** = `1793448648259.jpg`
    - **Screen Time (`#bottomNavStats`)** = `1793448759761.jpg`
    - **Focus (`#btnFocusSubTimer` & `#bottomNavFocus`)** = `1793448924228.jpg`
    - **Account (`#bottomNavAccount`)** = `1793448352426.jpg`
    - **Stats & Goals (`#btnFocusSubStats`)** = `1793447318715.jpg`

### E. Wishlist & Real UX Feedback Suite (Items 18–24)
18. **Weekly Behavioral Report Card**: Automated Sunday summary comparing Reel Velocity vs. Productive Focus Hours (`WeeklyBehavioralReportCardEngine` + `#weeklyBehavioralReportCard`).
19. **Lock Screen Widget Support**: Clean iOS/Android lock screen widget (`LockScreenWidgetBridge` + `#lockScreenWidgetPreviewCard`) showing today's unified Reel Count before unlocking the device.
20. **Brain State 1-Line Authoritative Tooltip**: Eye-catching compact 1-line tooltip (`#brainScoreAuthoritativeFormulaHint` — `"⚡ 3h velocity · session depth · context switches"`) with tap/hover breakdown popover.
21. **The Extension Dependency Gap**: Clear banner (`#webPreviewExtensionDependencyBanner`) stating `"Web Preview Mode: Connect Browser Extension to enable live auto-scrolling detection"`.
22. **Goal Adjustments Inside Modals**: Celebratory micro-interaction (`.ss-goal-locked-pulse` card pulse + `.ss-goal-bar-shimmer` bar pulse + toast confirmation) when saving a goal in `#screenTimeGoalModal`.
23. **Notification Fatigue Risk (`NotificationFatigueGuard`)**: Independent toggles for Sound/Hearing (`#toggleNotifEarphoneAlert`), Eye Strain/Blink (`#checkNotifEyeStrain`), and Posture (`#checkNotifPosture`), plus auto-muting wellness nudges during active Focus Mode (`#checkSuppressWellnessInFocus`).
24. **Edge-Case Friction (`ExtensionHeartbeatTamperGuard`)**: Alerts and locks session state if the browser extension or accessibility hook disconnects during an active limit or Focus session.

## 4. Out of Scope (Non-Goals)
- Unrequested UI redesigns or replacing `#accountBrainRowLiveMiniIcon`.
- Inspecting private message text, keystrokes, or personal media inside third-party apps.
