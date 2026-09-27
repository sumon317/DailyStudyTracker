package com.sumon.studytracker.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;
import android.widget.RemoteViews;

import com.sumon.studytracker.MainActivity;
import com.sumon.studytracker.R;

public class StudyWidgetProvider extends AppWidgetProvider {

    public static final String PREF_BASE = "timer_base_";
    static final String PREF_RUNNING = "timer_running_";
    static final String PREF_PAUSE_TIME = "timer_pause_time_";
    static final String PREF_THEME = "widget_theme_";

    private static final String TAG = "StudyWidgetProvider";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) {
            return;
        }
        // One binder round trip for the whole batch instead of one per id.
        int[] knownIds = getWidgetIds(context, appWidgetManager);
        for (int appWidgetId : appWidgetIds) {
            if (isKnownWidgetId(knownIds, appWidgetId)) {
                renderAppWidget(context, appWidgetManager, appWidgetId);
            }
        }
    }

    /**
     * Clears the per-widget timer and theme entries. Without this the {@code timer_*_<id>} keys
     * accumulate for every widget the user has ever placed, because the app widget id is never
     * reused.
     */
    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        if (context != null && appWidgetIds != null && appWidgetIds.length > 0) {
            try {
                clearWidgetState(context, appWidgetIds);
            } catch (Exception exception) {
                Log.e(TAG, "Widget cleanup failed (" + exception.getClass().getSimpleName() + ")");
            }
        }
        // Unconditional: super is a no-op, but a subclass or a future framework change must still
        // see the callback, and the early return above used to swallow it.
        super.onDeleted(context, appWidgetIds);
    }

    private static void clearWidgetState(Context context, int[] deletedWidgetIds) {
        SharedPreferences preferences = context.getSharedPreferences(
                WidgetDataStore.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] liveIds = manager == null ? new int[0] : getWidgetIds(context, manager);

        SharedPreferences.Editor editor = preferences.edit();
        for (int appWidgetId : deletedWidgetIds) {
            editor.remove(PREF_BASE + appWidgetId);
            editor.remove(PREF_PAUSE_TIME + appWidgetId);
            editor.remove(PREF_RUNNING + appWidgetId);
            editor.remove(PREF_THEME + appWidgetId);
        }
        // A host that was killed, or an uninstall that skipped the callback, never delivers
        // onDeleted, so ids of widgets that are long gone would otherwise sit in the preferences
        // file forever. Pruning is purely additive: the loop above already removed the ids this
        // broadcast named, whether or not the manager still reports them as live.
        for (String key : WidgetDataStore.staleWidgetKeys(
                preferences.getAll().keySet(),
                WidgetDataStore.toIdSet(liveIds)
        )) {
            editor.remove(key);
        }
        if (!editor.commit()) {
            Log.w(TAG, "Widget state cleanup could not be persisted");
        }
    }

    static int[] getWidgetIds(Context context, AppWidgetManager appWidgetManager) {
        if (context == null || appWidgetManager == null) {
            return new int[0];
        }
        int[] ids = appWidgetManager.getAppWidgetIds(
                new ComponentName(context, StudyWidgetProvider.class)
        );
        return ids == null ? new int[0] : ids;
    }

    /** Membership test against ids already fetched from {@link AppWidgetManager}. */
    static boolean isKnownWidgetId(int[] knownIds, int appWidgetId) {
        if (appWidgetId < 0 || knownIds == null) {
            return false;
        }
        for (int id : knownIds) {
            if (id == appWidgetId) {
                return true;
            }
        }
        return false;
    }

    public static boolean isValidWidgetId(Context context, int appWidgetId) {
        if (context == null || appWidgetId < 0) {
            return false;
        }
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) {
            return false;
        }
        return isKnownWidgetId(getWidgetIds(context, manager), appWidgetId);
    }

    static void updateAppWidget(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId
    ) {
        if (context == null || appWidgetManager == null || appWidgetId < 0) {
            return;
        }
        // Validating needs the live id list, so fetch it once and hand it to the batch entry point
        // rather than letting the render repeat the binder call per id.
        int[] knownIds = getWidgetIds(context, appWidgetManager);
        if (!isKnownWidgetId(knownIds, appWidgetId)) {
            return;
        }
        renderAppWidget(context, appWidgetManager, appWidgetId);
    }

    /**
     * Batch variant for callers that already hold the live id list (the plugin, the action
     * receiver, {@link #onUpdate}), so a repaint of N widgets costs one binder call rather than 2N.
     */
    static void updateAppWidget(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId,
            int[] knownIds
    ) {
        if (context == null || appWidgetManager == null) {
            return;
        }
        if (!isKnownWidgetId(knownIds, appWidgetId)) {
            return;
        }
        renderAppWidget(context, appWidgetManager, appWidgetId);
    }

    private static void renderAppWidget(
            Context context,
            AppWidgetManager appWidgetManager,
            int appWidgetId
    ) {
        try {
            SharedPreferences preferences = context.getSharedPreferences(
                    WidgetDataStore.PREFS_NAME,
                    Context.MODE_PRIVATE
            );
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);
            int theme = WidgetDataStore.themeForWidget(context, appWidgetId);
            applyTheme(views, theme);

            long nowElapsed = SystemClock.elapsedRealtime();
            long storedBase = preferences.getLong(PREF_BASE + appWidgetId, 0L);
            long storedPauseTime = preferences.getLong(PREF_PAUSE_TIME + appWidgetId, 0L);
            boolean storedRunning = preferences.getBoolean(PREF_RUNNING + appWidgetId, false);
            // A base that did not survive a reboot (or was never written) is untrustworthy, and a
            // banked duration larger than the current boot clock is too. Both restart the timer
            // rather than rendering device uptime as study time.
            WidgetTimerState state = WidgetTimerState.reconciled(
                    storedBase,
                    storedPauseTime,
                    storedRunning,
                    nowElapsed
            );
            if (state.base() != storedBase
                    || state.pauseTime() != storedPauseTime
                    || state.running() != storedRunning) {
                if (!writeTimerState(preferences, appWidgetId, state)) {
                    Log.w(TAG, "Stale widget timer state could not be reset");
                }
            }
            // A stopped Chronometer still renders elapsedRealtime() - base, so the paused duration
            // has to be converted back into a base rather than passed through as one.
            views.setChronometer(
                    R.id.widget_timer_chronometer,
                    state.chronometerBase(nowElapsed),
                    "%s",
                    state.running()
            );

            Intent serviceIntent = new Intent(context, StudyWidgetService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            // A stable per-widget data URI keeps one RemoteViewsFactory per placed widget; the
            // launcher only tears the factory down and rebuilds it when this actually changes.
            serviceIntent.setData(Uri.parse("studywidget://list/" + appWidgetId));
            views.setRemoteAdapter(R.id.widget_list, serviceIntent);
            views.setEmptyView(R.id.widget_list, R.id.empty_view);

            // Deliberately no extras: the stopwatch notification builds the same open-app
            // PendingIntent, and FLAG_UPDATE_CURRENT would rewrite any extra either side added.
            views.setOnClickPendingIntent(R.id.widget_root, getOpenAppPendingIntent(context));

            views.setOnClickPendingIntent(
                    R.id.widget_btn_play,
                    WidgetActionReceiver.getActionPendingIntent(
                            context,
                            appWidgetId,
                            WidgetActionReceiver.ACTION_TIMER_START
                    )
            );
            views.setOnClickPendingIntent(
                    R.id.widget_btn_pause,
                    WidgetActionReceiver.getActionPendingIntent(
                            context,
                            appWidgetId,
                            WidgetActionReceiver.ACTION_TIMER_PAUSE
                    )
            );
            views.setOnClickPendingIntent(
                    R.id.widget_btn_reset,
                    WidgetActionReceiver.getActionPendingIntent(
                            context,
                            appWidgetId,
                            WidgetActionReceiver.ACTION_TIMER_RESET
                    )
            );
            views.setOnClickPendingIntent(
                    R.id.widget_btn_theme,
                    WidgetActionReceiver.getActionPendingIntent(
                            context,
                            appWidgetId,
                            WidgetActionReceiver.ACTION_THEME_TOGGLE
                    )
            );

            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Exception exception) {
            Log.e(TAG, "Widget update failed (" + exception.getClass().getSimpleName() + ")");
        }
    }

    private static void applyTheme(RemoteViews views, int theme) {
        boolean isLightTheme = WidgetTheme.isLight(theme);
        if (isLightTheme) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_light);
            views.setInt(R.id.widget_timer_section, "setBackgroundResource", R.drawable.widget_section_light);
            views.setInt(R.id.widget_controls_section, "setBackgroundResource", R.drawable.widget_section_light);
            views.setInt(R.id.widget_btn_play, "setBackgroundResource", R.drawable.widget_btn_play_light);
            views.setInt(R.id.widget_btn_pause, "setBackgroundResource", R.drawable.widget_btn_pause_light);
            views.setInt(R.id.widget_btn_reset, "setBackgroundResource", R.drawable.widget_btn_reset_light);
            views.setTextColor(R.id.widget_btn_theme, WidgetTheme.themeButtonText(theme));
            views.setTextViewText(R.id.widget_btn_theme, WidgetTheme.themeButtonGlyph(theme));
            views.setInt(R.id.widget_btn_theme, "setBackgroundResource", R.drawable.widget_btn_theme_light);
            views.setTextColor(R.id.widget_timer_chronometer, WidgetTheme.timerText(theme));
        } else {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg);
            views.setInt(R.id.widget_timer_section, "setBackgroundResource", R.drawable.widget_section_dark);
            views.setInt(R.id.widget_controls_section, "setBackgroundResource", R.drawable.widget_section_dark);
            views.setInt(R.id.widget_btn_play, "setBackgroundResource", R.drawable.widget_btn_play);
            views.setInt(R.id.widget_btn_pause, "setBackgroundResource", R.drawable.widget_btn_pause);
            views.setInt(R.id.widget_btn_reset, "setBackgroundResource", R.drawable.widget_btn_reset);
            views.setTextColor(R.id.widget_btn_theme, WidgetTheme.themeButtonText(theme));
            views.setTextViewText(R.id.widget_btn_theme, WidgetTheme.themeButtonGlyph(theme));
            views.setInt(R.id.widget_btn_theme, "setBackgroundResource", R.drawable.widget_btn_theme);
            views.setTextColor(R.id.widget_timer_chronometer, WidgetTheme.timerText(theme));
        }

        views.setTextColor(R.id.widget_btn_play, 0xFFFFFFFF);
        views.setTextColor(R.id.widget_btn_pause, 0xFFFFFFFF);
        views.setTextColor(R.id.widget_btn_reset, 0xFFFFFFFF);
    }

    private static boolean writeTimerState(
            SharedPreferences preferences,
            int appWidgetId,
            WidgetTimerState state
    ) {
        return preferences.edit()
                .putLong(PREF_BASE + appWidgetId, state.base())
                .putLong(PREF_PAUSE_TIME + appWidgetId, state.pauseTime())
                .putBoolean(PREF_RUNNING + appWidgetId, state.running())
                .commit();
    }

    private static PendingIntent getOpenAppPendingIntent(Context context) {
        return PendingIntent.getActivity(
                context,
                0,
                new Intent(context, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );
    }

    private static int immutableFlag() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_IMMUTABLE;
        }
        return 0;
    }
}
