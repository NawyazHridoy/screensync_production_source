//
//  DeviceActivityMonitorExtension.swift
//  ScreenSyncDeviceActivityExtension
//
//  Runs in background via Apple's DeviceActivity framework even when the host app is closed.
//  Records genuine interval boundary and threshold crossings into the shared App Group container
//  (group.io.screensync.wellness) so the main app and Dynamic Island widget stay truthful.
//  NOTE: iOS DeviceActivityMonitor callbacks receive opaque DeviceActivityName / DeviceActivityEvent.Name
//  identifiers and CANNOT inspect individual short-form video swipes inside third-party apps.
//  Therefore, this extension never fabricates reel counts, watch durations, or hardcoded bundle IDs.
//

import DeviceActivity
import ManagedSettings
import Foundation
import WidgetKit

class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    
    let sharedDefaults = UserDefaults(suiteName: "group.io.screensync.wellness")
    let legacySharedDefaults = UserDefaults(suiteName: "group.com.screensync.shared")
    let store = ManagedSettingsStore()

    private func setSharedValue(_ value: Any?, forKey key: String) {
        sharedDefaults?.set(value, forKey: key)
        legacySharedDefaults?.set(value, forKey: key)
    }
    
    private func currentDayKey() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter.string(from: Date())
    }
    
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        sharedDefaults?.set(nowMs, forKey: "interval_start_\(activity.rawValue)")
        sharedDefaults?.set(currentDayKey(), forKey: "current_day_key")
        
        // Clear any leftover shields at the start of a new daily schedule interval
        if activity.rawValue == "daily_screensync_schedule" {
            store.shield.applications = nil
        }
    }
    
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let startMs = (sharedDefaults?.object(forKey: "interval_start_\(activity.rawValue)") as? Int64) ?? (nowMs - 900_000)
        let elapsedMs = max(0, nowMs - startMs)
        let dayKey = currentDayKey()
        
        // Accumulate entries per day instead of overwriting ios_usage_stats_json with a single entry
        var existingEntries: [[String: Any]] = []
        if let rawExisting = sharedDefaults?.string(forKey: "ios_usage_stats_json"),
           let data = rawExisting.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let savedDay = parsed["dayKey"] as? String,
           savedDay == dayKey,
           let entries = parsed["entries"] as? [[String: Any]] {
            existingEntries = entries
        }
        
        let newEntry: [String: Any] = [
            "activityName": activity.rawValue,
            "intervalStartMs": startMs,
            "intervalEndMs": nowMs,
            "totalTimeInForeground": elapsedMs,
            "lastTimeUsed": nowMs,
            "aggregateOnly": true,
            "hasVerifiedReelSessions": false,
            "reelMeasurementStatus": "UNAVAILABLE_ON_IOS_SANDBOX"
        ]
        existingEntries.append(newEntry)
        
        let payload: [String: Any] = [
            "dayKey": dayKey,
            "updatedAtMs": nowMs,
            "aggregateOnly": true,
            "hasVerifiedReelSessions": false,
            "reelMeasurementStatus": "UNAVAILABLE_ON_IOS_SANDBOX",
            "entries": existingEntries
        ]
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: payload),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
            setSharedValue(jsonStr, forKey: "ios_usage_stats_json")
        }
    }
    
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        
        let dayKey = currentDayKey()
        let savedDay = sharedDefaults?.string(forKey: "current_day_key") ?? ""
        if savedDay != dayKey {
            sharedDefaults?.set(dayKey, forKey: "current_day_key")
            sharedDefaults?.set(0, forKey: "daily_threshold_events_count")
            sharedDefaults?.set(0, forKey: "daily_reel_count")
            sharedDefaults?.set(0, forKey: "daily_watch_duration_ms")
        }
        
        // Record genuine threshold crossing count without fabricating per-reel counts or bundle IDs
        let prevThresholds = sharedDefaults?.integer(forKey: "daily_threshold_events_count") ?? 0
        let nextThresholds = prevThresholds + 1
        sharedDefaults?.set(nextThresholds, forKey: "daily_threshold_events_count")
        sharedDefaults?.set(event.rawValue, forKey: "last_threshold_event_name")
        
        let countersPayload: [String: Any] = [
            "dayKey": dayKey,
            "dailyReelCount": 0,
            "dailyWatchDurationMs": 0,
            "thresholdEventsCount": nextThresholds,
            "lastThresholdEventName": event.rawValue,
            "activityName": activity.rawValue,
            "hasVerifiedReelSessions": false,
            "reelMeasurementStatus": "UNAVAILABLE_ON_IOS_SANDBOX",
            "byPackage": [:] as [String: Int],
            "updatedAtMs": Int64(Date().timeIntervalSince1970 * 1000)
        ]
        
        if let data = try? JSONSerialization.data(withJSONObject: countersPayload),
           let str = String(data: data, encoding: .utf8) {
            setSharedValue(str, forKey: "ios_screensync_counters_json")
        }
        
        if #available(iOSApplicationExtension 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
