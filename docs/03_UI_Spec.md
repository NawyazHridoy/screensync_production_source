# 03_UI_Spec.md — Design System Tokens, Pure Launch Splash, Adaptive 5-Logo Standard & Responsive Rules

## 1. Color & Surface Tokens
- **Primary Canvas (Dark)**: `#030712` / `#07132B` with optical liquid-glass specular highlights (`rgba(56, 189, 248, 0.28)`).
- **Primary Canvas (Light)**: `#F8FAFC` / `rgba(255, 255, 255, 0.96)` with high-contrast slate typography (`#0F172A`).
- **High-Contrast Notification Banner (`#toastBanner`)**: `linear-gradient(165deg, rgba(7, 19, 43, 0.97) 0%, rgba(4, 11, 26, 0.98) 100%)`, border `1px solid rgba(56, 189, 248, 0.48)`, `#toastTitle` in `#FFFFFF`, and `#toastMessage` in `#E2E8F0`.

## 2. Pure Logo-Only Launch Splash (`#splashOverlay`) & 12-Preset Splash Studio (`#viewSplashAnimationStudio`)
- **Pure Launch Splash Rule**: `#splashOverlay` displays **ONLY the compact logo (`76px × 86px`) and its animation** on a pure `#000000` background. All text, titles, taglines, spinners, and progress bars (`.splash-loader-wrap`, `#splashCircularLoader`, `#splashProgressTrack`, `#splashTitle`, `#splashTagline`, `#brandTextContainer`) are visually hidden (`display: none !important; opacity: 0 !important; visibility: hidden !important; height: 0 !important;`).
- **Zero End-of-Animation Box Artifact**: `#splashOverlay .splash-logo-mask` and `.ss-splash-logo-rig` enforce `width: 76px !important; height: 86px !important; background: transparent !important; border: none !important; box-shadow: none !important; filter: none !important;`, and `.splash-halo-ring` uses `opacity: var(--ss-splash-halo-opacity, 0) !important` (default `0`).
- **Splash Studio Controls**: Preserves ONLY the `"FX & Halo Intensity"` slider (`#sliderSplashHaloIntensity`, range `0–160%`, default `0%`) and the 12-preset grid (`#splashPresetGridContainer`), completely omitting Section `"3. App Icon Scale & ScreenSync Branding"`.

## 3. Unified Equal-Sized & Multi-Mode Adaptive 5-Logo System (`.ss-adaptive-ui-icon`)
- **Strict Uniform Sizing (`sobar size same hobe`)**:
  - Mobile (`<640px`): `--ss-unified-icon-size: 22px` (`width: 22px !important; height: 22px !important; aspect-ratio: 1 / 1 !important`).
  - Tablet/Desktop (`>=640px`): `--ss-unified-icon-size: 24px` (`width: 24px !important; height: 24px !important; aspect-ratio: 1 / 1 !important`).
- **Authoritative 5-Logo Mapping**:
  1. **Home (`#bottomNavOverview`)** = `1793448648259.jpg` (3D Violet-Blue-Silver House)
  2. **Screen Time (`#bottomNavStats`)** = `1793448759761.jpg` (Metallic Cyan Clock Over Open Book)
  3. **Focus (`#btnFocusSubTimer` & `#bottomNavFocus`)** = `1793448924228.jpg` (Double-Ring Metallic Green Brain)
  4. **Account (`#bottomNavAccount`)** = `1793448352426.jpg` (Circular Orange-Gold Crescent Ring + User Avatar Bust)
  5. **Stats & Goals (`#btnFocusSubStats`)** = `1793447318715.jpg` (Circular Rising-Chart + Zig-Zag Arrow + Celebratory Figure)
- **Preserved Element**: `#accountBrainRowLiveMiniIcon` inside `#accountBrainRowIconWrap` is untouched.

## 4. Responsive Focus Hero Scene, Cards & Micro-Interaction Rules
- **Focus Hero Scene (`#focusHeroSceneCard`)**: `width: 100% !important; min-height: 220px !important; height: clamp(220px, 28vw, 320px) !important; padding: 0 !important; overflow: hidden !important;` with inner SVG `preserveAspectRatio="xMidYMid slice"` so there are zero side gaps across Phone, Tablet, Laptop, and PC.
- **Phone Mode Header Pill (`#crossDeviceGuideHelpBadge` / `.ss-guide-header-pill`)**: `inline-flex items-center justify-center text-center whitespace-nowrap shrink-0 leading-none px-3 py-1.5 rounded-full`.
- **Goal Save Celebratory Pulse**: `.ss-goal-locked-pulse` and `.ss-goal-bar-shimmer`.
