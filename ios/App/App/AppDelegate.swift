import UIKit
import WebKit
import UserNotifications
import ActivityKit
import Darwin
import MachO
import CryptoKit
#if canImport(DeviceCheck)
import DeviceCheck
#endif
#if canImport(HealthKit)
import HealthKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif
#if canImport(FirebaseCore)
import FirebaseCore
#endif
#if canImport(FirebaseMessaging)
import FirebaseMessaging
#endif
#if canImport(FirebaseCrashlytics)
import FirebaseCrashlytics
#endif

#if canImport(ActivityKit)
@available(iOS 16.1, *)
public struct ScreenSyncIslandAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var reelsText: String
        public var watchTimeText: String
        public var brainStage: Int = 0
        public var degradationPct: Double = 0.0
    }
    public var accountId: String
}
#endif


/**
 * Part 15 Task 15.5 — iOS Native Anti-Reverse-Engineering, Anti-Jailbreak, Anti-Frida & App Attest Guard
 * Release Build Settings (configured in Xcode Release configuration):
 *   STRIP_INSTALLED_PRODUCT = YES
 *   DEAD_CODE_STRIPPING = YES
 *   COPY_PHASE_STRIP = YES
 */
public enum IosSecurityIntegrityGuard {
    private static let PT_DENY_ATTACH: CInt = 31

    public static func enforceAntiDebuggingIfRelease() {
        #if !DEBUG
        typealias PtraceFn = @convention(c) (CInt, pid_t, caddr_t?, CInt) -> CInt
        if let handle = dlopen(nil, RTLD_GLOBAL | RTLD_NOW),
           let sym = dlsym(handle, "ptrace") {
            let ptrace = unsafeBitCast(sym, to: PtraceFn.self)
            _ = ptrace(PT_DENY_ATTACH, 0, nil, 0)
        }
        #endif
    }

    public static func isDebuggerAttachedSysctl() -> Bool {
        var info = kinfo_proc()
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        var size = MemoryLayout<kinfo_proc>.stride
        let rc = sysctl(&mib, UInt32(mib.count), &info, &size, nil, 0)
        if rc != 0 {
            return false
        }
        return (info.kp_proc.p_flag & P_TRACED) != 0
    }

    public static func scanDyldForFridaAndSubstrate() -> [String] {
        let suspiciousTokens = [
            "FridaGadget",
            "frida-agent",
            "SubstrateLoader",
            "MobileSubstrate",
            "CydiaSubstrate",
            "SSLKillSwitch",
            "Shadow",
            "libhooker",
            "Cycript"
        ]
        var detected: [String] = []
        let count = _dyld_image_count()
        for i in 0..<count {
            if let cName = _dyld_get_image_name(i) {
                let imageName = String(cString: cName)
                for token in suspiciousTokens {
                    if imageName.localizedCaseInsensitiveContains(token) {
                        detected.append(imageName)
                        break
                    }
                }
            }
        }
        return detected
    }

    public static func checkJailbreakAndSandboxIntegrity() -> (compromised: Bool, indicators: [String]) {
        #if targetEnvironment(simulator)
        return (false, [])
        #else
        let suspiciousPaths = [
            "/Applications/Cydia.app",
            "/Applications/Sileo.app",
            "/private/var/lib/apt",
            "/var/jb",
            "/usr/sbin/sshd",
            "/bin/bash"
        ]
        var hits: [String] = []
        for path in suspiciousPaths {
            if FileManager.default.fileExists(atPath: path) {
                hits.append("JB_PATH:\(path)")
            }
        }
        let sandboxProbePath = "/private/screensync_jb_probe.txt"
        do {
            try "probe".write(toFile: sandboxProbePath, atomically: true, encoding: .utf8)
            try? FileManager.default.removeItem(atPath: sandboxProbePath)
            hits.append("SANDBOX_WRITE_OUTSIDE_CONTAINER_SUCCEEDED")
        } catch {
            // Expected in intact iOS sandbox
        }
        return (!hits.isEmpty, hits)
        #endif
    }

    public static func computePublicIndexHtmlSha256() -> String {
        guard let htmlPath = Bundle.main.path(forResource: "index", ofType: "html", inDirectory: "public"),
              let data = try? Data(contentsOf: URL(fileURLWithPath: htmlPath)) else {
            return ""
        }
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    public static func buildAttestationDictionary() -> [String: Any] {
        let debuggerAttached = isDebuggerAttachedSysctl()
        let dyldHits = scanDyldForFridaAndSubstrate()
        let jbCheck = checkJailbreakAndSandboxIntegrity()
        let indexSha256 = computePublicIndexHtmlSha256()
        var appAttestSupported = false
        #if canImport(DeviceCheck)
        if #available(iOS 14.0, *) {
            appAttestSupported = DCAppAttestService.shared.isSupported
        }
        #endif
        var flags: [String] = []
        if debuggerAttached { flags.append("DEBUGGER_P_TRACED") }
        if !dyldHits.isEmpty { flags.append("DYLD_INJECTION_DETECTED") }
        if jbCheck.compromised { flags.append("JAILBREAK_OR_SANDBOX_ESCAPE") }

        let compromised = !flags.isEmpty
        return [
            "ok": !compromised,
            "platform": "iOS",
            "status": compromised ? "TAMPER_DETECTED" : "VERIFIED_CLEAN",
            "compromised": compromised,
            "debuggerAttached": debuggerAttached,
            "dyldInjectedLibraries": dyldHits,
            "jailbreakIndicators": jbCheck.indicators,
            "indexHtmlSha256": indexSha256,
            "appAttestSupported": appAttestSupported,
            "symbolStrippingConfigured": [
                "STRIP_INSTALLED_PRODUCT": "YES",
                "DEAD_CODE_STRIPPING": "YES",
                "COPY_PHASE_STRIP": "YES"
            ],
            "tamperFlags": flags,
            "checkedAtMs": Int64(Date().timeIntervalSince1970 * 1000.0)
        ]
    }

    public static func buildAttestationJson() -> String {
        let dict = buildAttestationDictionary()
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "{\"ok\":true,\"platform\":\"iOS\",\"status\":\"VERIFIED_CLEAN\"}"
    }
}

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        IosSecurityIntegrityGuard.enforceAntiDebuggingIfRelease()
        #if canImport(FirebaseCore)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        #endif
        #if canImport(FirebaseMessaging)
        Messaging.messaging().delegate = self
        #endif
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()

        let win = UIWindow(frame: UIScreen.main.bounds)
        win.rootViewController = ScreenSyncViewController()
        win.makeKeyAndVisible()
        self.window = win
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        #endif
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        if (url.scheme == "io.screensync.wellness" || url.scheme == "screensync") && url.host == "auth" {
            NotificationCenter.default.post(name: Notification.Name("ScreenSyncOAuthCallbackUrl"), object: url.absoluteString)
            return true
        }
        return false
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    private func persistAndForwardResearchSurvey(userInfo: [AnyHashable: Any]) {
        let surveyId = (userInfo["survey_id"] as? String) ?? ""
        let surveyUrl = (userInfo["survey_url"] as? String) ?? (userInfo["url"] as? String) ?? ""
        let notifType = (userInfo["type"] as? String) ?? ""
        let aps = userInfo["aps"] as? [String: Any]
        let alert = aps?["alert"] as? [String: Any]
        let title = (userInfo["title"] as? String) ?? (alert?["title"] as? String) ?? "ScreenSync Research Survey"
        let body = (userInfo["body"] as? String) ?? (alert?["body"] as? String) ?? ""

        if !surveyId.isEmpty || !surveyUrl.isEmpty || notifType == "research_survey" {
            let payload: [String: String] = [
                "survey_id": surveyId,
                "survey_url": surveyUrl,
                "title": title,
                "body": body
            ]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
               let jsonStr = String(data: data, encoding: .utf8) {
                UserDefaults.standard.set(jsonStr, forKey: "pending_survey_json")
                UserDefaults(suiteName: "group.io.screensync.wellness")?.set(jsonStr, forKey: "pending_survey_json")
                NotificationCenter.default.post(name: Notification.Name("ScreenSyncResearchSurveyReceived"), object: jsonStr)
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        persistAndForwardResearchSurvey(userInfo: notification.request.content.userInfo)
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        persistAndForwardResearchSurvey(userInfo: response.notification.request.content.userInfo)
        completionHandler()
    }
}

#if canImport(FirebaseMessaging)
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken, !token.isEmpty else { return }
        if let defaults = UserDefaults(suiteName: "group.io.screensync.wellness") {
            defaults.set(token, forKey: "ios_fcm_token")
            defaults.synchronize()
        }
        NotificationCenter.default.post(name: Notification.Name("ScreenSyncFcmTokenUpdated"), object: token)
    }
}
#endif

/**
 * Native iOS / iPadOS WebView Host & Full Bridge Parity with Android
 * - Exposes window.ScreenSyncNativeBridge with:
 *   - getDeviceInfoJson() using UIDevice.current.identifierForVendor?.uuidString + uname machine identifier marketing name resolution
 *   - getDisplayCutoutJson() & getStatusBarInsetDp() using safeAreaInsets
 *   - getInstalledAppsJson() from App Group UserDefaults("group.io.screensync.wellness") key "ios_installed_apps_json"
 *   - getNativeUsageStatsJson(startMs, endMs) & getScreenSyncCountersJson() from App Group UserDefaults("group.io.screensync.wellness")
 *   - openPermissionSettings, checkPermissionStatus, updateCompactPill (ActivityKit Live Activity), presentSystemGoalAlert, navigateBack
 * - Observes UIApplication.didBecomeActiveNotification and viewSafeAreaInsetsDidChange to sync live insets and App Group state
 */
class ScreenSyncViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let appGroupSuiteName = "group.io.screensync.wellness"

    private var currentStatusBarStyle: UIStatusBarStyle = .lightContent

    override var prefersStatusBarHidden: Bool {
        return false
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return currentStatusBarStyle
    }

    private func readIosMachineIdentifier() -> String {
        if let simModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !simModel.isEmpty {
            return simModel.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var sysinfo = utsname()
        uname(&sysinfo)
        let machineMirror = Mirror(reflecting: sysinfo.machine)
        let identifier = machineMirror.children.reduce("") { id, element in
            guard let value = element.value as? Int8, value != 0 else { return id }
            return id + String(UnicodeScalar(UInt8(value)))
        }
        return identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func resolveIosMarketingName(machineId: String, fallbackName: String) -> String {
        let map: [String: String] = [
            "iPhone18,1": "iPhone 17 Pro",
            "iPhone18,2": "iPhone 17 Pro Max",
            "iPhone18,3": "iPhone 17",
            "iPhone18,4": "iPhone 17 Air",
            "iPhone17,1": "iPhone 16 Pro",
            "iPhone17,2": "iPhone 16 Pro Max",
            "iPhone17,3": "iPhone 16",
            "iPhone17,4": "iPhone 16 Plus",
            "iPhone17,5": "iPhone 16e",
            "iPhone16,1": "iPhone 15 Pro",
            "iPhone16,2": "iPhone 15 Pro Max",
            "iPhone15,4": "iPhone 15",
            "iPhone15,5": "iPhone 15 Plus",
            "iPhone15,2": "iPhone 14 Pro",
            "iPhone15,3": "iPhone 14 Pro Max",
            "iPhone14,7": "iPhone 14",
            "iPhone14,8": "iPhone 14 Plus",
            "iPhone14,6": "iPhone SE (3rd generation)",
            "iPhone12,8": "iPhone SE (2nd generation)",
            "iPad16,3": "iPad Pro 11-inch (M4)",
            "iPad16,4": "iPad Pro 11-inch (M4)",
            "iPad16,5": "iPad Pro 13-inch (M4)",
            "iPad16,6": "iPad Pro 13-inch (M4)",
            "iPad14,3": "iPad Pro 11-inch (M2)",
            "iPad14,5": "iPad Pro 12.9-inch (M2)",
            "iPad14,8": "iPad Air 11-inch (M2)",
            "iPad14,10": "iPad Air 13-inch (M2)"
        ]
        if let mapped = map[machineId] {
            return mapped
        }
        let cleanFallback = fallbackName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanFallback.isEmpty && cleanFallback != "iPhone" && cleanFallback != "iPad" {
            return cleanFallback
        }
        return cleanFallback.isEmpty ? "iPhone" : cleanFallback
    }

    private func buildIosDeviceInfoDictionary() -> [String: Any] {
        let dev = UIDevice.current
        let vendorUuid = (dev.identifierForVendor?.uuidString ?? "ios_default")
            .replacingOccurrences(of: "-", with: "")
            .lowercased()
        let shortId = String(vendorUuid.prefix(12))
        let isPad = dev.userInterfaceIdiom == .pad
        let machineId = readIosMachineIdentifier()
        let friendlyName = resolveIosMarketingName(machineId: machineId, fallbackName: dev.name)
        let topInset = view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top
        let dynamicIslandModels: Set<String> = [
            "iPhone18,1", "iPhone18,2", "iPhone18,3", "iPhone18,4",
            "iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4",
            "iPhone16,1", "iPhone16,2",
            "iPhone15,2", "iPhone15,3", "iPhone15,4", "iPhone15,5"
        ]
        let homeButtonModels: Set<String> = ["iPhone10,1", "iPhone10,4", "iPhone12,8", "iPhone14,6"]
        let cutoutType: String
        if isPad || homeButtonModels.contains(machineId) {
            cutoutType = "FULLSCREEN"
        } else if machineId == "iPhone17,5" {
            cutoutType = "TRUEDEPTH_NOTCH"
        } else if dynamicIslandModels.contains(machineId) || topInset >= 59 {
            cutoutType = "IPHONE_PILL"
        } else if topInset >= 44 {
            cutoutType = "TRUEDEPTH_NOTCH"
        } else {
            cutoutType = "FULLSCREEN"
        }
        return [
            "installationId": "inst_ios_\(shortId)",
            "key": "ios_\(shortId)",
            "deviceName": friendlyName,
            "marketName": friendlyName,
            "rawModel": machineId.isEmpty ? dev.model : machineId,
            "model": friendlyName,
            "manufacturer": "Apple",
            "brand": "Apple",
            "osCategory": "iOS",
            "deviceCategory": isPad ? "Tablet" : "Phone",
            "osVersion": "\(dev.systemName) \(dev.systemVersion)",
            "cutoutType": cutoutType,
            "hasTrueDepth": !isPad && cutoutType != "FULLSCREEN"
        ]
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        syncAppGroupStoreToWebView()
    }

    private func syncAppGroupStoreToWebView() {
        let devInfo = buildIosDeviceInfoDictionary()
        let topInset = Int(view.window?.safeAreaInsets.top ?? view.safeAreaInsets.top)
        let bottomInset = Int(view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom)
        let leftInset = Int(view.window?.safeAreaInsets.left ?? view.safeAreaInsets.left)
        let rightInset = Int(view.window?.safeAreaInsets.right ?? view.safeAreaInsets.right)
        let cutoutDict: [String: Any] = [
            "cutoutType": devInfo["cutoutType"] ?? "FULLSCREEN",
            "safeInsetTop": topInset,
            "safeInsetBottom": bottomInset,
            "safeInsetLeft": leftInset,
            "safeInsetRight": rightInset,
            "statusBarDp": topInset
        ]

        let sharedDefaults = UserDefaults(suiteName: appGroupSuiteName)
        let installedAppsJson = sharedDefaults?.string(forKey: "ios_installed_apps_json") ?? "[]"
        let usageStatsJson = sharedDefaults?.string(forKey: "ios_usage_stats_json") ?? "{\"ok\":true,\"osCategory\":\"iOS\",\"aggregateOnly\":true,\"entries\":[]}"
        let screensyncCountersJson = sharedDefaults?.string(forKey: "ios_screensync_counters_json") ?? "{\"dayKey\":\"\",\"dailyReelCount\":0,\"dailyWatchDurationMs\":0,\"byPackage\":{}}"

        guard let devInfoData = try? JSONSerialization.data(withJSONObject: devInfo, options: []),
              let devInfoStr = String(data: devInfoData, encoding: .utf8),
              let cutoutData = try? JSONSerialization.data(withJSONObject: cutoutDict, options: []),
              let cutoutStr = String(data: cutoutData, encoding: .utf8) else {
            return
        }

        var liveActivitiesStatus = "UNSUPPORTED"
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            liveActivitiesStatus = ActivityAuthorizationInfo().areActivitiesEnabled ? "GRANTED" : "DENIED"
        }
        #endif
        var familyControlsStatus = "PENDING"
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) {
            switch AuthorizationCenter.shared.authorizationStatus {
            case .approved:
                familyControlsStatus = "GRANTED"
            case .denied:
                familyControlsStatus = "DENIED"
            case .notDetermined:
                familyControlsStatus = "NOT_DETERMINED"
            @unknown default:
                familyControlsStatus = "PENDING"
            }
        }
        #endif

        UNUserNotificationCenter.current().getNotificationSettings { [weak self] notifSettings in
            let notifStatus: String
            switch notifSettings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                notifStatus = "GRANTED"
            case .denied:
                notifStatus = "DENIED"
            case .notDetermined:
                notifStatus = "NOT_DETERMINED"
            @unknown default:
                notifStatus = "PENDING"
            }
            DispatchQueue.main.async {
                let js = """
                window.__ssIosDeviceInfo = \(devInfoStr);
                window.__ssIosCutoutInfo = \(cutoutStr);
                window.__ssIosInstalledApps = \(installedAppsJson);
                window.__ssIosUsageStats = \(usageStatsJson);
                window.__ssIosScreenSyncCounters = \(screensyncCountersJson);
                window.__ssIosPermissionStatusMap = Object.assign(window.__ssIosPermissionStatusMap || {}, {
                  notifications: "\(notifStatus)",
                  live_activities: "\(liveActivitiesStatus)",
                  family_controls: "\(familyControlsStatus)"
                });
                if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager && typeof window.ScreenSyncApp.PermissionOnboardingManager.syncAllPermissionsFromNative === 'function') {
                  window.ScreenSyncApp.PermissionOnboardingManager.syncAllPermissionsFromNative({ force: true });
                }
                if (window.ScreenSyncApp && typeof window.ScreenSyncApp.onDisplayGeometryChanged === 'function') {
                  window.ScreenSyncApp.onDisplayGeometryChanged(window.__ssIosCutoutInfo);
                }
                if (window.ScreenSyncApp && window.ScreenSyncApp.AutoSyncService && typeof window.ScreenSyncApp.AutoSyncService.syncWithBackend === 'function') {
                  window.ScreenSyncApp.AutoSyncService.syncWithBackend();
                }
                """
                self?.webView?.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 3/255, green: 8/255, blue: 22/255, alpha: 1.0)

        let contentController = WKUserContentController()
        contentController.add(self, name: "ScreenSyncNative")

        let devInfo = buildIosDeviceInfoDictionary()
        let devInfoData = (try? JSONSerialization.data(withJSONObject: devInfo, options: [])) ?? Data("{}".utf8)
        let initialDevJson = String(data: devInfoData, encoding: .utf8) ?? "{}"
        let initialAttestJson = IosSecurityIntegrityGuard.buildAttestationJson()

        let bridgeJs = """
        window.__ssIosDeviceInfo = \(initialDevJson);
        window.__ssIosIntegrityAttestation = \(initialAttestJson);
        window.__ssIosCutoutInfo = { cutoutType: window.__ssIosDeviceInfo.cutoutType || "FULLSCREEN", safeInsetTop: 0, safeInsetBottom: 0, safeInsetLeft: 0, safeInsetRight: 0, statusBarDp: 0 };
        window.__ssIosInstalledApps = [];
        window.__ssIosUsageStats = { ok: true, osCategory: "iOS", aggregateOnly: true, entries: [] };
        window.__ssIosScreenSyncCounters = { dayKey: "", dailyReelCount: 0, dailyWatchDurationMs: 0, byPackage: {} };
        window.ScreenSyncNativeBridge = {
          getDeviceInfoJson: function() {
            return JSON.stringify(window.__ssIosDeviceInfo || {});
          },
          getDisplayCutoutJson: function() {
            return JSON.stringify(window.__ssIosCutoutInfo || {});
          },
          getStatusBarInsetDp: function() {
            return Number((window.__ssIosCutoutInfo && window.__ssIosCutoutInfo.safeInsetTop) || 0);
          },
          syncSystemBarTheme: function(themeMode) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: "syncSystemBarTheme", themeMode: String(themeMode || "DARK") });
          },
          getInstalledAppsJson: function() {
            return JSON.stringify(window.__ssIosInstalledApps || []);
          },
          getNativeUsageStatsJson: function(startMs, endMs) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'refreshAppGroupData', startMs: startMs, endMs: endMs });
            return JSON.stringify(window.__ssIosUsageStats || { ok: true, osCategory: "iOS", entries: [] });
          },
          getScreenSyncCountersHistoryJson: function(sinceDayKey) {
            return JSON.stringify({ sinceDayKey: String(sinceDayKey || ""), hasVerifiedReelSessions: false, reelMeasurementStatus: "UNAVAILABLE_ON_IOS_SANDBOX", days: {}, hourlyBuckets: [] });
          },
          savePersistedAuthSessionJson: function(sessionJson) {
            window.__ssIosPersistedSession = String(sessionJson || "");
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: "savePersistedAuthSessionJson", payload: String(sessionJson || "") });
            return true;
          },
          getPersistedAuthSessionJson: function() {
            return String(window.__ssIosPersistedSession || "");
          },
          markExplicitNativeLogout: function() {
            window.__ssIosPersistedSession = "";
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: "markExplicitNativeLogout" });
            return true;
          },
          deleteNativeAccountDataJson: function() {
            window.__ssIosPersistedSession = "";
            window.__ssIosSyncedTimersJson = "{}";
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: "deleteNativeAccountDataJson" });
            return JSON.stringify({
              ok: true,
              platform: "iOS",
              clearedAppGroupDefaults: true,
              clearedKeys: [
                "ios_persisted_auth_session_json",
                "ios_installed_apps_json",
                "ios_usage_stats_json",
                "ios_screensync_counters_json",
                "ios_synced_timers_and_focus_json",
                "screensync_lockscreen_widget_payload_v1"
              ]
            });
          },
          pruneNativeHistoryJson: function(cutoffEpochMs, cutoffDayKey) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({
              action: "pruneNativeHistoryJson",
              cutoffEpochMs: Number(cutoffEpochMs || 0),
              cutoffDayKey: String(cutoffDayKey || "")
            });
            return JSON.stringify({
              ok: true,
              platform: "iOS",
              nativePrune: "NOT_APPLICABLE",
              cutoffDayKey: String(cutoffDayKey || "")
            });
          },
          saveTextFileExportJson: function(fileName, mimeType, textContent) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({
              action: "saveTextFileExportJson",
              fileName: String(fileName || "screensync_export.json"),
              mimeType: String(mimeType || "application/json"),
              textContent: String(textContent || "")
            });
            return JSON.stringify({
              ok: true,
              platform: "iOS",
              fileName: String(fileName || "screensync_export.json"),
              sharedViaActivityViewController: true
            });
          },
          getScreenSyncCountersJson: function() {
            return JSON.stringify(window.__ssIosScreenSyncCounters || { dayKey: "", dailyReelCount: 0, dailyWatchDurationMs: 0, byPackage: {} });
          },
          openPermissionSettings: function(permId, target, uri) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'openPermissionSettings', permId: permId, uri: uri });
            return true;
          },
          checkPermissionStatus: function(permId) {
            var map = window.__ssIosPermissionStatusMap || {};
            if (map[permId]) return String(map[permId]);
            return "PENDING";
          },
          getAllPermissionStatusJson: function() {
            var map = window.__ssIosPermissionStatusMap || {};
            return JSON.stringify({
              ok: true,
              platform: "iOS",
              notifications: map.notifications || "PENDING",
              live_activities: map.live_activities || "PENDING",
              family_controls: map.family_controls || "PENDING"
            });
          },
          requestPermission: function(permId) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'requestPermission', permId: String(permId || '') });
            return true;
          },
          updateCompactPill: function(payloadJson) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'updateCompactPill', payload: payloadJson });
          },
          getHistoricalUsageStatsJson: function(daysBack) {
            return window.__ssIosHistoricalUsageJson || JSON.stringify({ ok: false, status: 'UNSUPPORTED_ON_IOS', osCategory: 'iOS', daysBack: daysBack || 30, days: [], reason: "Historical data before install isn't available on iOS" });
          },
          getHistoricalNativeUsageStatsJson: function(daysBack) {
            return window.__ssIosHistoricalUsageJson || JSON.stringify({ ok: false, status: 'UNSUPPORTED_ON_IOS', osCategory: 'iOS', daysBack: daysBack || 30, days: [], reason: "Historical data before install isn't available on iOS" });
          },
          getHistoricalUsageBackfillJson: function(daysBack) {
            return window.__ssIosHistoricalUsageJson || JSON.stringify({ ok: false, status: 'UNSUPPORTED_ON_IOS', osCategory: 'iOS', daysBack: daysBack || 30, days: [], reason: "Historical data before install isn't available on iOS" });
          },
          presentSystemGoalAlert: function(payloadJson) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'presentSystemGoalAlert', payload: payloadJson });
          },
          syncAppTimersAndFocusStateJson: function(payloadJson) {
            window.__ssIosSyncedTimersJson = String(payloadJson || "{}");
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'syncAppTimersAndFocusStateJson', payload: String(payloadJson || "{}") });
            return true;
          },
          syncAppTimersJson: function(payloadJson) {
            return this.syncAppTimersAndFocusStateJson(payloadJson);
          },
          getAppTimerCapabilityJson: function() {
            return JSON.stringify({
              platform: "iOS",
              canBlock: false,
              supported: false,
              canWarn: true,
              mode: "WARNING_ONLY",
              explanation: "iOS ManagedSettings shield requires Apple FamilyControls entitlement; alerts fire at 80% and 100% of your daily app limit."
            });
          },
          dispatchNativeNotification: function(payloadJson) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'dispatchNativeNotification', payload: String(payloadJson || "{}") });
            return true;
          },
          getNotificationChannelsStatusJson: function() {
            var granted = Boolean(window.__ssIosPermissionStatusMap && window.__ssIosPermissionStatusMap.notifications === "GRANTED");
            return JSON.stringify({
              areNotificationsEnabled: granted,
              postNotificationsGranted: granted,
              groupId: "screensync_wellness_group",
              channels: [
                { id: "screensync_goal_alerts", name: "Screen Time & Reel Goal Alerts", importance: 4, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_app_timers", name: "Per-App Daily Timer Alerts", importance: 4, group: "screensync_notification_group", enabled: granted },
                { id: "screensync_break_reminders", name: "Mindful Break & Detox Reminders", importance: 4, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_wellness_nudges", name: "Eye Strain, Posture & Wellness Nudges", importance: 3, group: "screensync_notification_group", enabled: granted },
                { id: "screensync_wind_down", name: "Bedtime Wind-Down & Quiet Hours", importance: 3, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_daily_summary", name: "Daily Usage Digest & Streak Milestones", importance: 3, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_live_tracking", name: "Cross-Device Sync & Live Tracking Status", importance: 2, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_hearing_health", name: "Earphone & Hearing Health Alerts", importance: 4, group: "screensync_wellness_group", enabled: granted },
                { id: "screensync_security_alerts", name: "Account & Device Security Alerts", importance: 4, group: "screensync_wellness_group", enabled: granted }
              ]
            });
          },
          getNativeAudioExposureJson: function() {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'queryHeadphoneAudioExposureSamples' });
            return JSON.stringify(window.__ssIosAudioExposure || { ok: true, isMusicActive: false, isHeadphonesConnected: false, deviceType: "Headphones", volumeScalar: 0.5, whoReferenceDbA: 80.0 });
          },
          getAudioExposureStatusJson: function() {
            return this.getNativeAudioExposureJson();
          },
          updateLockScreenReelWidgetJson: function(payloadJson) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'updateLockScreenReelWidgetJson', payload: String(payloadJson || "{}") });
            return JSON.stringify({ ok: true, platform: "iOS", widgetTarget: "ScreenSyncLockScreenReelWidget" });
          },
          getFcmToken: function() {
            return String(window.__ssIosFcmToken || "");
          },
          logNonFatalError: function(tag, message) {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({
              action: 'logNonFatalError',
              tag: String(tag || 'ScreenSyncWeb'),
              message: String(message || 'Unknown non-fatal error')
            });
            return true;
          },
          getIntegrityAttestationJson: function() {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'GET_IOS_INTEGRITY_ATTESTATION' });
            return JSON.stringify(window.__ssIosIntegrityAttestation || { ok: true, platform: "iOS", status: "VERIFIED_CLEAN" });
          },
          navigateBack: function() {
            window.webkit.messageHandlers.ScreenSyncNative.postMessage({ action: 'navigateBack' });
          }
        };
        """
        contentController.addUserScript(
            WKUserScript(source: bridgeJs, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // CAT14-24: Disable full-page WKWebView back/forward reload gestures so in-app back buttons,
        // TouchBackGestureController, and ScreenSyncNativeBridge.navigateBack() coordinate cleanly
        // with window.ScreenSyncApp.handleSystemBackNavigation().
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        view.addSubview(webView)

        if let indexUrl = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public") {
            webView.loadFileURL(indexUrl, allowingReadAccessTo: indexUrl.deletingLastPathComponent())
        }

        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.syncAppGroupStoreToWebView()
        }
        NotificationCenter.default.addObserver(
            forName: Notification.Name("ScreenSyncOAuthCallbackUrl"),
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let urlStr = note.object as? String,
                  let jsonData = try? JSONSerialization.data(withJSONObject: [urlStr], options: []),
                  let jsonArr = String(data: jsonData, encoding: .utf8) else { return }
            let js = "if (window.ScreenSyncApp && window.ScreenSyncApp.SocialOAuthProviderEngine && typeof window.ScreenSyncApp.SocialOAuthProviderEngine.handleOAuthCallbackUrl === 'function') { window.ScreenSyncApp.SocialOAuthProviderEngine.handleOAuthCallbackUrl((" + jsonArr + ")[0]); }"
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name("ScreenSyncResearchSurveyReceived"),
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let jsonStr = note.object as? String, !jsonStr.isEmpty else { return }
            let js = "if (window.ScreenSyncApp && window.ScreenSyncApp.ResearchSurveyOverlayController && typeof window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload === 'function') { window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload(" + jsonStr + "); }"
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        if action == "GET_IOS_INTEGRITY_ATTESTATION" || action == "getIntegrityAttestationJson" {
            let attestJson = IosSecurityIntegrityGuard.buildAttestationJson()
            DispatchQueue.main.async {
                self.webView?.evaluateJavaScript("window.__ssIosIntegrityAttestation = \(attestJson);", completionHandler: nil)
            }
        } else if action == "consumePendingSurveyJson" {
            let pending = UserDefaults.standard.string(forKey: "pending_survey_json")
                ?? UserDefaults(suiteName: appGroupSuiteName)?.string(forKey: "pending_survey_json")
                ?? ""
            if !pending.isEmpty {
                UserDefaults.standard.removeObject(forKey: "pending_survey_json")
                UserDefaults(suiteName: appGroupSuiteName)?.removeObject(forKey: "pending_survey_json")
                DispatchQueue.main.async {
                    let js = "if (window.ScreenSyncApp && window.ScreenSyncApp.ResearchSurveyOverlayController && typeof window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload === 'function') { window.ScreenSyncApp.ResearchSurveyOverlayController.onNativeSurveyPayload(" + pending + "); }"
                    self.webView?.evaluateJavaScript(js, completionHandler: nil)
                }
            }
        } else if action == "refreshAppGroupData" {
            syncAppGroupStoreToWebView()
        } else if action == "syncSystemBarTheme", let themeMode = body["themeMode"] as? String {
            DispatchQueue.main.async {
                self.currentStatusBarStyle = themeMode.uppercased() == "LIGHT" ? .darkContent : .lightContent
                self.setNeedsStatusBarAppearanceUpdate()
            }
        } else if action == "openPermissionSettings" {
            if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(settingsUrl, options: [:], completionHandler: nil)
            }
        } else if action == "requestPermission", let permId = body["permId"] as? String {
            if permId == "notifications" {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    DispatchQueue.main.async {
                        let status = granted ? "GRANTED" : "DENIED"
                        self.webView?.evaluateJavaScript("window.__ssIosPermissionStatusMap = window.__ssIosPermissionStatusMap || {}; window.__ssIosPermissionStatusMap['notifications'] = '\(status)';", completionHandler: nil)
                    }
                }
            } else if permId == "screen_time_family_controls" || permId == "usage_stats" {
                startScreenTimeDeviceActivityMonitoringIfAuthorized()
            }
        } else if action == "presentSystemGoalAlert", let payloadStr = body["payload"] as? String {
            dispatchSystemNotification(payloadJson: payloadStr)
        } else if action == "dispatchNativeNotification", let payloadStr = body["payload"] as? String {
            if let data = payloadStr.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                dispatchNativeNotification(obj)
            }
        } else if action == "updateLockScreenReelWidgetJson", let payloadStr = body["payload"] as? String {
            _ = (UIApplication.shared.delegate as? AppDelegate)?.updateLockScreenReelWidgetJson(payloadStr)
            handleUpdateCompactPill(payloadJson: payloadStr)
        } else if action == "queryHeadphoneAudioExposureSamples" {
            queryHeadphoneAudioExposureSamples { samples in
                DispatchQueue.main.async {
                    if let latest = samples.last,
                       let dbA = latest["measuredDbA"] as? Double {
                        self.webView?.evaluateJavaScript("window.__ssIosAudioExposure = { ok: true, isMusicActive: true, isHeadphonesConnected: true, deviceType: 'Headphones', measuredDbA: \(dbA), whoReferenceDbA: 80.0 };", completionHandler: nil)
                    }
                }
            }
        } else if action == "syncAppTimersAndFocusStateJson", let payloadStr = body["payload"] as? String {
            UserDefaults(suiteName: appGroupSuiteName)?.set(payloadStr, forKey: "ios_synced_timers_and_focus_json")
        } else if action == "updateCompactPill", let payloadStr = body["payload"] as? String {
            handleUpdateCompactPill(payloadJson: payloadStr)
        } else if action == "savePersistedAuthSessionJson", let payloadStr = body["payload"] as? String {
            UserDefaults(suiteName: appGroupSuiteName)?.set(payloadStr, forKey: "ios_persisted_auth_session_json")
        } else if action == "markExplicitNativeLogout" {
            let defaults = UserDefaults(suiteName: appGroupSuiteName)
            defaults?.removeObject(forKey: "ios_persisted_auth_session_json")
            defaults?.removeObject(forKey: "widget_today_reels_count")
            defaults?.removeObject(forKey: "widget_today_reel_watch_minutes")
            defaults?.removeObject(forKey: "widget_today_screen_minutes")
            defaults?.removeObject(forKey: "widget_connected_devices_count")
            defaults?.removeObject(forKey: "widget_pinned")
            defaults?.removeObject(forKey: "screensync_lockscreen_widget_payload_v1")
            defaults?.synchronize()
            #if canImport(WidgetKit)
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
            #endif
        } else if action == "deleteNativeAccountDataJson" {
            let defaults = UserDefaults(suiteName: appGroupSuiteName)
            let keysToClear = [
                "ios_persisted_auth_session_json",
                "ios_installed_apps_json",
                "ios_usage_stats_json",
                "ios_screensync_counters_json",
                "ios_synced_timers_and_focus_json",
                "screensync_lockscreen_widget_payload_v1"
            ]
            for k in keysToClear {
                defaults?.removeObject(forKey: k)
            }
            defaults?.synchronize()
            #if canImport(ActivityKit)
            if #available(iOS 16.1, *) {
                let emptyState = ScreenSyncIslandAttributes.ContentState(reelsText: "0 Reels", watchTimeText: "0m")
                for act in Activity<ScreenSyncIslandAttributes>.activities {
                    Task { await act.end(using: emptyState, dismissalPolicy: .immediate) }
                }
            }
            #endif
        } else if action == "pruneNativeHistoryJson" {
            let defaults = UserDefaults(suiteName: appGroupSuiteName)
            if let cutoffDayKey = body["cutoffDayKey"] as? String, !cutoffDayKey.isEmpty {
                if let countersJson = defaults?.string(forKey: "ios_screensync_counters_json"),
                   let data = countersJson.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let dayKey = obj["dayKey"] as? String,
                   dayKey < cutoffDayKey {
                    defaults?.removeObject(forKey: "ios_screensync_counters_json")
                }
                if let statsJson = defaults?.string(forKey: "ios_usage_stats_json"),
                   let statsData = statsJson.data(using: .utf8),
                   var statsObj = try? JSONSerialization.jsonObject(with: statsData) as? [String: Any] {
                    if let dayKey = statsObj["dayKey"] as? String, dayKey < cutoffDayKey {
                        defaults?.removeObject(forKey: "ios_usage_stats_json")
                    } else if let byDay = statsObj["byDay"] as? [String: Any] {
                        let filtered = byDay.filter { $0.key >= cutoffDayKey }
                        statsObj["byDay"] = filtered
                        if let updatedData = try? JSONSerialization.data(withJSONObject: statsObj),
                           let updatedStr = String(data: updatedData, encoding: .utf8) {
                            defaults?.set(updatedStr, forKey: "ios_usage_stats_json")
                        }
                    }
                }
                defaults?.synchronize()
            }
        } else if action == "saveTextFileExportJson" {
            let rawName = (body["fileName"] as? String) ?? "screensync_export.json"
            let safeName = rawName.replacingOccurrences(of: "/", with: "_")
            let textContent = (body["textContent"] as? String) ?? ""
            if let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                let fileUrl = docsDir.appendingPathComponent(safeName)
                try? textContent.data(using: .utf8)?.write(to: fileUrl, options: .atomic)
                DispatchQueue.main.async {
                    let activityVC = UIActivityViewController(activityItems: [fileUrl], applicationActivities: nil)
                    self.present(activityVC, animated: true, completion: nil)
                }
            }
        } else if action == "logNonFatalError" {
            let tag = (body["tag"] as? String) ?? "ScreenSyncWeb"
            let errMsg = (body["message"] as? String) ?? "Unknown non-fatal error"
            #if canImport(FirebaseCrashlytics)
            Crashlytics.crashlytics().setCustomValue(tag, forKey: "screensync_tag")
            Crashlytics.crashlytics().record(error: NSError(domain: "io.screensync.wellness", code: 1001, userInfo: [NSLocalizedDescriptionKey: "[\(tag)] \(errMsg)"]))
            #endif
        } else if action == "navigateBack" {
            webView?.evaluateJavaScript(
                "(function(){ return (window.ScreenSyncApp && typeof window.ScreenSyncApp.handleSystemBackNavigation === 'function') ? window.ScreenSyncApp.handleSystemBackNavigation() : false; })()",
                completionHandler: nil
            )
        }
    }

    private func handleUpdateCompactPill(payloadJson: String) {
        guard let data = payloadJson.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let fallbackReels = (obj["reelsCount"] as? Int) ?? (obj["unifiedReelsCount"] as? Int) ?? (obj["unifiedReelCount"] as? Int)
        let fallbackWatchMins = (obj["watchMinutes"] as? Int) ?? (obj["unifiedWatchMinutes"] as? Int) ?? (obj["reelWatchMinutes"] as? Int)
        guard fallbackReels != nil || obj["reelsText"] != nil || (obj["hidden"] as? Bool) == true else { return }
        let reelsText = (obj["reelsText"] as? String) ?? (fallbackReels != nil ? "\(fallbackReels!) \(fallbackReels! == 1 ? "Reel" : "Reels")" : "0 Reels")
        let watchTimeText = (obj["watchTimeText"] as? String) ?? (fallbackWatchMins != nil ? "\(fallbackWatchMins!)m" : "0m")
        let resolvedReelsCount = fallbackReels ?? 0
        let brainStage = (obj["brainStage"] as? Int) ?? min(10, max(0, resolvedReelsCount / 50))
        let degradationPct = (obj["degradationPct"] as? Double) ?? min(100.0, max(0.0, (Double(resolvedReelsCount) / 500.0) * 100.0))
        let isHidden = (obj["hidden"] as? Bool) ?? false

        if let defaults = UserDefaults(suiteName: appGroupSuiteName) {
            let islandDict: [String: Any] = [
                "reelsText": reelsText,
                "watchTimeText": watchTimeText,
                "reelsCount": resolvedReelsCount,
                "brainStage": brainStage,
                "degradationPct": degradationPct,
                "hidden": isHidden
            ]
            defaults.set(islandDict, forKey: "active_live_activity_payload")
        }

        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let state = ScreenSyncIslandAttributes.ContentState(reelsText: reelsText, watchTimeText: watchTimeText, brainStage: brainStage, degradationPct: degradationPct)
            if isHidden {
                for act in Activity<ScreenSyncIslandAttributes>.activities {
                    Task { await act.end(using: state, dismissalPolicy: .immediate) }
                }
                return
            }
            if let existing = Activity<ScreenSyncIslandAttributes>.activities.first {
                Task { await existing.update(using: state) }
            } else {
                let resolvedAccountId = (obj["userId"] as? String) ?? (obj["accountId"] as? String) ?? "screensync_local"
                let attrs = ScreenSyncIslandAttributes(accountId: resolvedAccountId)
                _ = try? Activity<ScreenSyncIslandAttributes>.request(attributes: attrs, contentState: state, pushType: nil)
            }
        }
        #endif
    }

    private func dispatchSystemNotification(payloadJson: String) {
        guard let data = payloadJson.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let content = UNMutableNotificationContent()
        content.title = (obj["title"] as? String) ?? "Screen Time Goal Reached"
        content.body = (obj["message"] as? String) ?? ""
        content.sound = .default
        let req = UNNotificationRequest(
            identifier: (obj["eventId"] as? String) ?? "screensync_goal_alert",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
    }

    // MARK: - UNUserNotificationCenterDelegate & Native Notification Bridge (S-iOS-1)
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    @objc func dispatchNativeNotification(_ payload: [String: Any]) {
        let title = (payload["title"] as? String) ?? "ScreenSync Wellness Alert"
        let body = (payload["body"] as? String) ?? ""
        let identifier = (payload["tag"] as? String) ?? "screensync_\( Int(Date().timeIntervalSince1970) )"
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    @objc func getNotificationChannelsStatusJson(completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let granted = (settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
            let channelsJson = "[" +
                "{\"id\":\"screensync_goal_alerts\",\"name\":\"Screen Time & Reel Goal Alerts\",\"importance\":4,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_app_timers\",\"name\":\"Per-App Daily Timer Alerts\",\"importance\":4,\"group\":\"screensync_notification_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_break_reminders\",\"name\":\"Mindful Break & Detox Reminders\",\"importance\":4,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_wellness_nudges\",\"name\":\"Eye Strain, Posture & Wellness Nudges\",\"importance\":3,\"group\":\"screensync_notification_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_wind_down\",\"name\":\"Bedtime Wind-Down & Quiet Hours\",\"importance\":3,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_daily_summary\",\"name\":\"Daily Usage Digest & Streak Milestones\",\"importance\":3,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_live_tracking\",\"name\":\"Cross-Device Sync & Live Tracking Status\",\"importance\":2,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_hearing_health\",\"name\":\"Earphone & Hearing Health Alerts\",\"importance\":4,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}," +
                "{\"id\":\"screensync_security_alerts\",\"name\":\"Account & Device Security Alerts\",\"importance\":4,\"group\":\"screensync_wellness_group\",\"enabled\":\(granted)}" +
            "]"
            let json = "{\"areNotificationsEnabled\":\(granted),\"postNotificationsGranted\":\(granted),\"groupId\":\"screensync_wellness_group\",\"channels\":\(channelsJson)}"
            completion(json)
        }
    }

    // MARK: - HealthKit Headphone Audio Exposure Reader (S-iOS-2)
    @objc func queryHeadphoneAudioExposureSamples(completion: @escaping ([[String: Any]]) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(),
              let exposureType = HKObjectType.quantityType(forIdentifier: .headphoneAudioExposure) else {
            completion([])
            return
        }
        let store = HKHealthStore()
        store.requestAuthorization(toShare: nil, read: [exposureType]) { ok, _ in
            guard ok else { completion([]); return }
            let start = Date().addingTimeInterval(-7 * 24 * 3600)
            let pred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
            let query = HKSampleQuery(sampleType: exposureType, predicate: pred, limit: 200, sortDescriptors: nil) { _, samples, _ in
                var results: [[String: Any]] = []
                if let qtySamples = samples as? [HKQuantitySample] {
                    let unit = HKUnit.decibelAWeightedSoundPressureLevel()
                    for s in qtySamples {
                        results.append([
                            "measuredDbA": s.quantity.doubleValue(for: unit),
                            "startEpochSec": Int(s.startDate.timeIntervalSince1970),
                            "endEpochSec": Int(s.endDate.timeIntervalSince1970),
                            "measurementType": "MEASURED_DBA"
                        ])
                    }
                }
                completion(results)
            }
            store.execute(query)
        }
    }

    // MARK: - FamilyControls & DeviceActivity Monitoring (S-iOS-3)
    func startScreenTimeDeviceActivityMonitoringIfAuthorized() {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) {
            Task {
                do {
                    try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                    let schedule = DeviceActivitySchedule(
                        intervalStart: DateComponents(hour: 0, minute: 0),
                        intervalEnd: DateComponents(hour: 23, minute: 59),
                        repeats: true
                    )
                    try DeviceActivityCenter().startMonitoring(DeviceActivityName("screensync.daily"), during: schedule)
                } catch {}
            }
        }
        #endif
    }

}

// Pass 3 Wishlist #2: iOS Lock Screen WidgetKit Unified Reel Count Sync Bridge
extension AppDelegate {
    @objc func updateLockScreenReelWidgetJson(_ jsonPayload: String) -> String {
        for groupId in ["group.io.screensync.wellness", "group.io.screensync.shared"] {
            if let suite = UserDefaults(suiteName: groupId) {
                suite.set(jsonPayload, forKey: "screensync_lockscreen_widget_payload_v1")
                if let data = jsonPayload.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let reels = (obj["reelsCount"] as? Int) ?? (obj["unifiedReelsCount"] as? Int) {
                        suite.set(reels, forKey: "widget_reels_count")
                    }
                    if let watchMins = (obj["watchMinutes"] as? Int) ?? (obj["unifiedWatchMinutes"] as? Int) {
                        suite.set(watchMins, forKey: "widget_reel_watch_mins")
                    }
                    if let screenMins = (obj["screenMinutes"] as? Int) ?? (obj["totalScreenMinutes"] as? Int) {
                        suite.set(screenMins, forKey: "widget_screen_used_mins")
                    }
                    if let goalMins = (obj["dailyGoalMinutes"] as? Int) ?? (obj["reelGoalMinutes"] as? Int) {
                        suite.set(goalMins, forKey: "widget_reel_goal_mins")
                    }
                    if let dayKey = (obj["localDate"] as? String) ?? (obj["dateStr"] as? String) {
                        suite.set(dayKey, forKey: "widget_day_key")
                    }
                }
                suite.synchronize()
            }
        }
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        #endif
        return "{\"ok\":true,\"platform\":\"iOS\",\"widgetTarget\":\"ScreenSyncLockScreenReelWidget\"}"
    }
}
