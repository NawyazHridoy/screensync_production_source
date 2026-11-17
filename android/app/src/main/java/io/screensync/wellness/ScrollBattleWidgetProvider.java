package io.screensync.wellness;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * ScrollBattleWidgetProvider (Part 16 Feature 2.8)
 * Home-screen widget displaying live Scroll Battle / Friends Duel standing and a quick Nudge action.
 */
public class ScrollBattleWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "screensync_widget_state";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int myReels = prefs.getInt("today_reels", 0);
        String rivalName = prefs.getString("battle_rival_name", "No rival linked");
        int rivalReels = prefs.getInt("battle_rival_reels", 0);
        String standingText = prefs.getString("battle_standing_text", "Invite a friend to start a Scroll Battle");

        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_scroll_battle);
            views.setTextViewText(R.id.widgetBattleTitle, "Scroll Battle • " + myReels + " reels");
            views.setTextViewText(R.id.widgetBattleStanding, standingText);
            views.setTextViewText(R.id.widgetBattleRival, rivalName + " (" + rivalReels + ")");

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.putExtra("open_section", "SCROLL_BATTLE");
            PendingIntent pi = PendingIntent.getActivity(
                context,
                appWidgetId + 300,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widgetBattleRoot, pi);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}
