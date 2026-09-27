package com.sumon.studytracker.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.sumon.studytracker.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class StudyWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int appWidgetId = intent == null
                ? AppWidgetManager.INVALID_APPWIDGET_ID
                : intent.getIntExtra(
                        AppWidgetManager.EXTRA_APPWIDGET_ID,
                        AppWidgetManager.INVALID_APPWIDGET_ID
                );
        boolean valid = StudyWidgetProvider.isValidWidgetId(this, appWidgetId);
        return new StudyWidgetFactory(getApplicationContext(), appWidgetId, !valid);
    }
}

class StudyWidgetFactory implements RemoteViewsService.RemoteViewsFactory {

    private static final String TAG = "StudyWidgetService";

    private final Context context;
    private final int appWidgetId;
    private final List<JSONObject> items = new ArrayList<>();
    private final WidgetItemIds itemIds = new WidgetItemIds();
    private boolean empty;
    private int theme = WidgetTheme.DARK;

    StudyWidgetFactory(Context context, int appWidgetId, boolean empty) {
        this.context = context;
        this.appWidgetId = appWidgetId;
        this.empty = empty;
    }

    @Override
    public void onCreate() {
    }

    @Override
    public void onDataSetChanged() {
        clearItems();
        if (empty) {
            // The id was not registered when this factory was built, which happens when the
            // launcher binds the RemoteViews service before it has finished registering the
            // widget. Re-checking here keeps that race from blanking the list for the whole life
            // of the factory, which is long lived because the provider's data URI is stable.
            empty = !StudyWidgetProvider.isValidWidgetId(context, appWidgetId);
        }
        SharedPreferences preferences = context.getSharedPreferences(
                WidgetDataStore.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        String storedDate = preferences.getString(WidgetDataStore.PREF_DATE, null);
        if (empty || !WidgetDataStore.isToday(storedDate)) {
            return;
        }
        // Read the same key the provider uses, so a per-widget toggle repaints the rows too.
        theme = WidgetDataStore.themeForWidget(context, appWidgetId);

        String storedData = preferences.getString(WidgetDataStore.PREF_DATA, "[]");
        if (storedData != null && storedData.length() > WidgetDataStore.MAX_DATA_LENGTH) {
            Log.w(TAG, "Stored widget payload exceeds the supported size");
            return;
        }
        try {
            JSONArray array = new JSONArray(storedData == null ? "[]" : storedData);
            // The plugin refuses to store a payload past the cap, so this bound is
            // belt and braces for a store written by a build that used to truncate
            // instead: an oversized record can only predate the current writer.
            int count = Math.min(array.length(), WidgetTimeUtils.MAX_ITEMS);
            int currentMinutes = WidgetDataStore.currentMinutesOfDay();

            for (int index = 0; index < count; index++) {
                JSONObject object = array.optJSONObject(index);
                if (object == null) {
                    continue;
                }
                if (WidgetTimeUtils.isPastPlannedEnd(
                        currentMinutes,
                        object.optString("time", ""),
                        object.optString("planned", "0")
                )) {
                    continue;
                }
                items.add(object);
            }

            Collections.sort(items, new Comparator<JSONObject>() {
                @Override
                public int compare(JSONObject first, JSONObject second) {
                    return WidgetTimeUtils.compareByStartTime(
                            first.optString("time", ""),
                            second.optString("time", "")
                    );
                }
            });
        } catch (Exception | StackOverflowError exception) {
            // StackOverflowError is reachable here: a payload of nothing but nested brackets is
            // still under the size cap, and org.json recurses per nesting level. A factory that
            // dies here would take the launcher's collection view down with it.
            clearItems();
            Log.e(TAG, "Widget data load failed (" + exception.getClass().getSimpleName() + ")");
        }
    }

    @Override
    public void onDestroy() {
        clearItems();
    }

    @Override
    public int getCount() {
        if (!WidgetDataStore.isCurrentDate(context)) {
            return 0;
        }
        return items.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
        int count = getCount();
        if (position < 0 || position >= count) {
            return null;
        }
        try {
            return renderItem(items.get(position));
        } catch (Exception exception) {
            Log.e(TAG, "Widget item render failed (" + exception.getClass().getSimpleName() + ")");
            // A bare layout rather than null. From Android 15 the launcher may ask for a whole
            // collection at once, and it writes each returned view straight into a parcel without
            // a null check, so a null here would escape as an uncaught NullPointerException and
            // take this process down instead of leaving one row blank.
            return new RemoteViews(context.getPackageName(), R.layout.widget_item);
        }
    }

    private RemoteViews renderItem(JSONObject item) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_item);
        String name = WidgetTimeUtils.clampText(
                item.optString("name", "Subject"),
                WidgetTimeUtils.MAX_NAME_LENGTH
        );
        String time = item.optString("time", "");
        String planned = WidgetTimeUtils.clampText(
                item.optString("planned", "0"),
                WidgetTimeUtils.MAX_MINUTES_LENGTH
        );
        String actual = WidgetTimeUtils.clampText(
                item.optString("actual", "0"),
                WidgetTimeUtils.MAX_MINUTES_LENGTH
        );

        views.setTextViewText(R.id.widget_subject_name, name);
        views.setTextViewText(R.id.widget_subject_time, WidgetTimeUtils.displayTime(time));
        views.setTextViewText(R.id.widget_subject_kpi, actual + "/" + planned + " min");
        // A background resource rather than setBackgroundColor, so the row keeps the rounded
        // corners the layout draws and the two themes stay independent.
        views.setInt(
                R.id.widget_item_root,
                "setBackgroundResource",
                WidgetTheme.isLight(theme)
                        ? R.drawable.widget_item_bg_light
                        : R.drawable.widget_item_bg
        );
        views.setTextColor(R.id.widget_subject_name, WidgetTheme.subjectName(theme));
        views.setTextColor(R.id.widget_subject_time, WidgetTheme.subjectTime(theme));
        views.setTextColor(R.id.widget_subject_kpi, WidgetTheme.subjectKpi(theme));
        return views;
    }

    @Override
    public RemoteViews getLoadingView() {
        return null;
    }

    @Override
    public int getViewTypeCount() {
        return 1;
    }

    @Override
    public long getItemId(int position) {
        int count = getCount();
        if (position < 0 || position >= count) {
            return -1L;
        }
        JSONObject item = items.get(position);
        return itemIds.idAt(
                position,
                item.optString("id", ""),
                item.optString("name", ""),
                item.optString("time", "")
        );
    }

    @Override
    public boolean hasStableIds() {
        return true;
    }

    private void clearItems() {
        items.clear();
        itemIds.reset();
        theme = WidgetTheme.DARK;
    }
}
