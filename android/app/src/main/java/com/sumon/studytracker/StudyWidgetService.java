package com.sumon.studytracker;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class StudyWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new StudyWidgetFactory(this.getApplicationContext(), intent);
    }
}

class StudyWidgetFactory implements RemoteViewsService.RemoteViewsFactory {
    private Context context;
    private List<JSONObject> items = new ArrayList<>();

    public StudyWidgetFactory(Context context, Intent intent) {
        this.context = context;
    }

    @Override
    public void onCreate() {}

    @Override
    public void onDataSetChanged() {
        items.clear();
        SharedPreferences prefs = context.getSharedPreferences("WidgetPrefs", Context.MODE_PRIVATE);
        String dataStr = prefs.getString("data", "[]");
        try {
            JSONArray jsonArray = new JSONArray(dataStr);
            for (int i = 0; i < jsonArray.length(); i++) {
                items.add(jsonArray.getJSONObject(i));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onDestroy() {
        items.clear();
    }

    @Override
    public int getCount() {
        return items.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
        if (position >= items.size()) return null;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_item);
        try {
            JSONObject item = items.get(position);
            String name = item.optString("name", "Subject");
            String time = item.optString("time", "");
            String planned = item.optString("planned", "0");
            String actual = item.optString("actual", "0");

            views.setTextViewText(R.id.widget_subject_name, name);
            
            // Convert 24hr time to 12hr format with AM/PM
            String displayTime = "--:--";
            if (!time.isEmpty()) {
                try {
                    String[] parts = time.split(":");
                    int hour = Integer.parseInt(parts[0]);
                    int minute = Integer.parseInt(parts[1]);
                    String period = (hour >= 12) ? "PM" : "AM";
                    int displayHour = hour % 12;
                    if (displayHour == 0) displayHour = 12;
                    displayTime = displayHour + ":" + String.format("%02d", minute) + " " + period;
                } catch (Exception e) {
                    displayTime = time; // Fallback to original
                }
            }
            views.setTextViewText(R.id.widget_subject_time, displayTime);

            String progressText = actual + "/" + planned + " min";
            views.setTextViewText(R.id.widget_subject_kpi, progressText);

            // Apply theme-based colors (2 themes: 0=Dark, 1=Light)
            SharedPreferences prefs = context.getSharedPreferences("WidgetPrefs", Context.MODE_PRIVATE);
            int theme = prefs.getInt("current_theme", 0);
            boolean isLightTheme = (theme == 1);
            
            // Alternating row colors (zebra striping)
            int rowBgColor;
            if (isLightTheme) {
                // Light themes - alternating light backgrounds
                rowBgColor = (position % 2 == 0) ? 0x1A000000 : 0x0D000000; // Darker / Lighter
                views.setTextColor(R.id.widget_subject_name, 0xFF0F172A); // Slate-900
                views.setTextColor(R.id.widget_subject_time, 0xFF4F46E5); // Indigo-600
                views.setTextColor(R.id.widget_subject_kpi, 0xFF475569);  // Slate-600
            } else {
                // Dark themes - alternating dark backgrounds
                rowBgColor = (position % 2 == 0) ? 0x33FFFFFF : 0x1AFFFFFF; // Lighter / Darker
                views.setTextColor(R.id.widget_subject_name, 0xFFFFFFFF); // White
                views.setTextColor(R.id.widget_subject_time, 0xFF818CF8); // Indigo-400
                views.setTextColor(R.id.widget_subject_kpi, 0xFFCBD5E1);  // Slate-300
            }
            
            // Apply row background color
            views.setInt(R.id.widget_item_root, "setBackgroundColor", rowBgColor);
            
        } catch (Exception e) {
            e.printStackTrace();
        }

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
        return position;
    }

    @Override
    public boolean hasStableIds() {
        return true;
    }
}
