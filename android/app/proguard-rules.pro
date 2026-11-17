# ScreenSync Android R8 / ProGuard Hardening Rules (Part 15 Task 15.1)
# Keep entry-point classes required by AndroidManifest.xml (names only, obfuscate private internals)
-keep public class io.screensync.wellness.ScreenSyncSecureApplication
-keep public class io.screensync.wellness.MainActivity
-keep public class io.screensync.wellness.ScreenSyncAccessibilityService
-keep public class io.screensync.wellness.BootCompletedReceiver
-keep public class io.screensync.wellness.WellbeingRefreshScheduler$WellbeingSystemEventReceiver
-keep public class io.screensync.wellness.ReelTrackerWidgetProvider
-keep public class io.screensync.wellness.ScreenTimeGoalWidgetProvider
-keep public class io.screensync.wellness.ScrollBattleWidgetProvider
-keep public class io.screensync.wellness.FallbackReelsCounterService
-keep public class io.screensync.wellness.ScreenSyncBackgroundSyncReceiver
-keep public class io.screensync.wellness.ScreenSyncFirebaseMessagingService
-keep public class com.pairip.application.Application { *; }
-keep public class com.pairip.licensecheck.** { *; }

# Keep @JavascriptInterface methods exposed to WebView
-keepclassmembers class io.screensync.wellness.MainActivity$ScreenSyncNativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class io.screensync.wellness.MainActivity$ScreenSyncAndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Aggressive R8 optimization & repackaging to defeat MT Manager / JADX browsing
-optimizationpasses 5
-repackageclasses 'o'
-allowaccessmodification
-overloadaggressively
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable,JavascriptInterface,Annotation

# Strip all verbose logging in release builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
-dontwarn com.android.billingclient.**
-dontwarn com.google.android.play.core.**
-dontwarn com.pairip.**
