import ActivityKit
import WidgetKit
import SwiftUI

struct ScreenSyncIslandAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var reelsCount: Int
        var reelWatchMinutes: Int
        var totalScreenMinutes: Int
        var reelGoalMinutes: Int
        var screenGoalMinutes: Int
        var connectedDevicesCount: Int
        var activeAppName: String
        var isFocusRunning: Bool
        var focusRemainingSeconds: Int
        var brainStage: Int = 0
        var degradationPct: Double = 0.0
    }
    var accountId: String
}

struct ScreenSyncWidgetTimelineEntry: TimelineEntry {
    let date: Date
    let reelsCount: Int
    let reelWatchMinutes: Int
    let totalScreenMinutes: Int
    let reelGoalMinutes: Int
    let screenGoalMinutes: Int
    let connectedDevicesCount: Int
}

struct ScreenSyncWidgetTimelineProvider: TimelineProvider {
    static let appGroupId = "group.io.screensync.wellness"

    private func readCurrentEntry() -> ScreenSyncWidgetTimelineEntry {
        let defaults = UserDefaults(suiteName: Self.appGroupId)
        var jsonPayload: [String: Any]? = nil
        if let rawJson = defaults?.string(forKey: "screensync_lockscreen_widget_payload_v1"),
           let data = rawJson.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            jsonPayload = parsed
        }
        let reels = defaults?.object(forKey: "widget_today_reels_count") != nil
            ? (defaults?.integer(forKey: "widget_today_reels_count") ?? 0)
            : ((jsonPayload?["unifiedReelCount"] as? Int) ?? (jsonPayload?["reelsCount"] as? Int) ?? 0)
        let reelMins = defaults?.object(forKey: "widget_today_reel_watch_minutes") != nil
            ? (defaults?.integer(forKey: "widget_today_reel_watch_minutes") ?? 0)
            : ((jsonPayload?["reelWatchMinutes"] as? Int) ?? (jsonPayload?["watchMinutes"] as? Int) ?? 0)
        let screenMins = defaults?.object(forKey: "widget_today_screen_minutes") != nil
            ? (defaults?.integer(forKey: "widget_today_screen_minutes") ?? 0)
            : ((jsonPayload?["totalScreenMinutes"] as? Int) ?? (jsonPayload?["screenMinutes"] as? Int) ?? 0)
        let rGoalRaw = defaults?.object(forKey: "widget_reel_goal_minutes") != nil
            ? (defaults?.integer(forKey: "widget_reel_goal_minutes") ?? 60)
            : ((jsonPayload?["reelGoalMinutes"] as? Int) ?? (jsonPayload?["dailyGoalMinutes"] as? Int) ?? 60)
        let sGoalRaw = defaults?.object(forKey: "widget_screen_goal_minutes") != nil
            ? (defaults?.integer(forKey: "widget_screen_goal_minutes") ?? 200)
            : ((jsonPayload?["screenGoalMinutes"] as? Int) ?? 200)
        let devCountRaw = defaults?.object(forKey: "widget_connected_devices_count") != nil
            ? (defaults?.integer(forKey: "widget_connected_devices_count") ?? 1)
            : ((jsonPayload?["connectedDevicesCount"] as? Int) ?? 1)
        return ScreenSyncWidgetTimelineEntry(
            date: Date(),
            reelsCount: max(0, reels),
            reelWatchMinutes: max(0, reelMins),
            totalScreenMinutes: max(0, screenMins),
            reelGoalMinutes: max(5, rGoalRaw),
            screenGoalMinutes: max(15, sGoalRaw),
            connectedDevicesCount: max(1, devCountRaw)
        )
    }

    func placeholder(in context: Context) -> ScreenSyncWidgetTimelineEntry {
        readCurrentEntry()
    }

    func getSnapshot(in context: Context, completion: @escaping (ScreenSyncWidgetTimelineEntry) -> Void) {
        completion(readCurrentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScreenSyncWidgetTimelineEntry>) -> Void) {
        let entry = readCurrentEntry()
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct ScreenSyncReelWidgetEntryView: View {
    var entry: ScreenSyncWidgetTimelineEntry
    @Environment(\.widgetFamily) var family

    private func formatDuration(_ mins: Int) -> String {
        let h = mins / 60
        let m = mins % 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: min(1.0, Double(entry.reelWatchMinutes) / Double(max(1, entry.reelGoalMinutes)))) {
                Text("Reels")
            } currentValueLabel: {
                Text("\(entry.reelsCount)")
                    .font(.system(size: 14, weight: .bold))
            }
            .gaugeStyle(.accessoryCircular)
            .widgetURL(URL(string: "screensync://open?tab=STATS&metric=REELS_COUNT"))
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("ScreenSync • All Devices")
                    .font(.system(size: 11, weight: .semibold))
                Text("\(entry.reelsCount) \(entry.reelsCount == 1 ? "Reel" : "Reels") • \(formatDuration(entry.reelWatchMinutes))")
                    .font(.system(size: 13, weight: .bold))
                Text("Screen: \(formatDuration(entry.totalScreenMinutes)) / \(formatDuration(entry.screenGoalMinutes))")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
            .widgetURL(URL(string: "screensync://open?tab=OVERVIEW"))
        case .accessoryInline:
            Text("ScreenSync: \(entry.reelsCount) \(entry.reelsCount == 1 ? "Reel" : "Reels") (\(formatDuration(entry.reelWatchMinutes)))")
                .widgetURL(URL(string: "screensync://open?tab=STATS&metric=REELS_COUNT"))
        default:
            VStack(alignment: .leading, spacing: 6) {
                Text("SCREENSYNC REELS")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color(red: 0.22, green: 0.74, blue: 0.97))
                Text("\(entry.reelsCount) \(entry.reelsCount == 1 ? "Reel" : "Reels")")
                    .font(.system(size: 22, weight: .extrabold))
                    .foregroundColor(.white)
                Text("\(formatDuration(entry.reelWatchMinutes)) watched • Goal \(formatDuration(entry.reelGoalMinutes))")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.gray)
                ProgressView(value: min(1.0, Double(entry.reelWatchMinutes) / Double(max(1, entry.reelGoalMinutes))))
                    .tint(Color(red: 0.20, green: 0.96, blue: 0.65))
                Text("Unified across \(entry.connectedDevicesCount) \(entry.connectedDevicesCount == 1 ? "device" : "devices")")
                    .font(.system(size: 10))
                    .foregroundColor(Color(red: 0.20, green: 0.96, blue: 0.65))
            }
            .padding(12)
            .background(Color(red: 0.05, green: 0.08, blue: 0.15))
            .widgetURL(URL(string: "screensync://open?tab=STATS&metric=REELS_COUNT"))
        }
    }
}

struct ScreenSyncHomeAndLockWidget: Widget {
    let kind: String = "ScreenSyncReelTrackerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScreenSyncWidgetTimelineProvider()) { entry in
            ScreenSyncReelWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Reel & Short-Form Counter")
        .description("Live cross-device Reel count, watch time, and daily Screen Time goal progress.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline
        ])
    }
}

typealias ScreenSyncReelTrackerWidget = ScreenSyncHomeAndLockWidget
typealias ScreenSyncLockScreenReelWidget = ScreenSyncHomeAndLockWidget
typealias ScreenSyncUnifiedReelLockWidget = ScreenSyncHomeAndLockWidget

@available(iOS 16.2, *)
struct ScreenSyncIslandLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ScreenSyncIslandAttributes.self) { context in
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ScreenSync • All Devices")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text("\(context.state.reelsCount) \(context.state.reelsCount == 1 ? "Reel" : "Reels") • \(context.state.reelWatchMinutes)m watched")
                        .font(.subheadline)
                        .bold()
                        .foregroundColor(.white)
                }
                Spacer()
                Text("\(context.state.totalScreenMinutes / 60)h \(context.state.totalScreenMinutes % 60)m")
                    .font(.headline)
                    .foregroundColor(Color(red: 0.20, green: 0.96, blue: 0.65))
            }
            .padding(14)
            .activityBackgroundTint(Color.black.opacity(0.88))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("REELS TODAY")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.cyan)
                        Text("\(context.state.reelsCount) \(context.state.reelsCount == 1 ? "Reel" : "Reels")")
                            .font(.system(size: 18, weight: .extrabold))
                            .foregroundColor(.white)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("SCREEN TIME")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.green)
                        Text("\(context.state.totalScreenMinutes / 60)h \(context.state.totalScreenMinutes % 60)m")
                            .font(.system(size: 18, weight: .extrabold))
                            .foregroundColor(.white)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text("Watch Time: \(context.state.reelWatchMinutes)m / \(context.state.reelGoalMinutes)m goal")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Spacer()
                        if context.state.isFocusRunning {
                            Text("Focus: \(context.state.focusRemainingSeconds / 60)m left")
                                .font(.caption2)
                                .foregroundColor(.orange)
                        }
                    }
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Text("\(context.state.reelsCount) \(context.state.reelsCount == 1 ? "Reel" : "Reels")")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.cyan)
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(context.state.brainStage >= 8 ? .red : (context.state.brainStage >= 4 ? .orange : .green))
                }
            } compactTrailing: {
                Text("\(context.state.totalScreenMinutes / 60)h \(context.state.totalScreenMinutes % 60)m")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.green)
            } minimal: {
                Text("\(context.state.reelsCount)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.cyan)
            }
        }
    }
}

@main
struct ScreenSyncWidgetBundle: WidgetBundle {
    var body: some Widget {
        ScreenSyncHomeAndLockWidget()
        if #available(iOS 16.2, *) {
            ScreenSyncIslandLiveActivity()
        }
    }
}
