package com.sumon.studytracker;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

@CapacitorPlugin(name = "WidgetData")
public class WidgetDataPlugin extends Plugin {

    @PluginMethod
    public void updateData(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Data is null");
            return;
        }

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences("WidgetPrefs", Context.MODE_PRIVATE);
        prefs.edit().putString("data", data).apply();

        // Trigger Widget Update
        Intent intent = new Intent(context, StudyWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        
        // Get all ids
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        int[] ids = appWidgetManager.getAppWidgetIds(new ComponentName(context, StudyWidgetProvider.class));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        
        context.sendBroadcast(intent);

        // Notify specifically for list view data change
        appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);

        call.resolve();
    }
}
