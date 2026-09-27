package com.sumon.studytracker.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.sumon.studytracker.R;

import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    @PluginMethod
    public void updateData(PluginCall call) {
        String data = call.getString("data");
        String date = call.getString("date");
        if (data == null) {
            call.reject("Data is required");
            return;
        }
        if (date == null) {
            call.reject("Date is required");
            return;
        }
        // Cheapest checks first: a rejected payload should never pay for a full JSON parse.
        if (data.length() > WidgetDataStore.MAX_DATA_LENGTH) {
            call.reject("Data is too large");
            return;
        }
        if (!WidgetDataStore.isValidDate(date)) {
            call.reject("Date must use YYYY-MM-DD");
            return;
        }
        try {
            JSONArray array = new JSONArray(data);
            if (array.length() > WidgetTimeUtils.MAX_ITEMS) {
                // Rejected, not truncated. The web layer refuses the same payload for the same
                // reason - `MAX_WIDGET_ITEMS` in `src/services/widgetService.ts` - so a day with
                // more subjects than the cap now says so on both sides. Truncating here alone left
                // the widget quietly rendering a prefix of the day with nothing to indicate that
                // the rest was dropped.
                call.reject("Too many items; the widget renders at most " + WidgetTimeUtils.MAX_ITEMS);
                return;
            }
        } catch (JSONException | StackOverflowError exception) {
            // StackOverflowError is reachable: a payload of nested brackets stays under the size
            // cap, and org.json recurses once per nesting level. Left uncaught it would propagate
            // through the bridge and take the WebView down.
            call.reject("Data must be a JSON array");
            return;
        }

        Context context = getContext();
        if (context == null) {
            call.reject("Application context unavailable");
            return;
        }
        SharedPreferences preferences = context.getSharedPreferences(
                WidgetDataStore.PREFS_NAME,
                Context.MODE_PRIVATE
        );
        // Persist before notifying so a widget refresh can never read a half-written pair of
        // data/date keys, which would blank the list until the next update.
        boolean persisted = preferences.edit()
                .putString(WidgetDataStore.PREF_DATA, data)
                .putString(WidgetDataStore.PREF_DATE, date)
                .commit();
        if (!persisted) {
            call.reject("Unable to persist widget data");
            return;
        }

        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        if (appWidgetManager == null) {
            call.resolve();
            return;
        }
        int[] appWidgetIds = StudyWidgetProvider.getWidgetIds(context, appWidgetManager);
        if (appWidgetIds.length == 0) {
            call.resolve();
            return;
        }

        // One binder round trip for the whole batch, reused for the per-widget repaint.
        for (int appWidgetId : appWidgetIds) {
            StudyWidgetProvider.updateAppWidget(context, appWidgetManager, appWidgetId, appWidgetIds);
        }
        // After the RemoteViews refresh, so the row factory observes the committed payload.
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_list);
        call.resolve();
    }
}
