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
            String kpi = item.optString("kpi", "N");

            views.setTextViewText(R.id.widget_subject_name, name);
            views.setTextViewText(R.id.widget_subject_time, time.isEmpty() ? "--:--" : time);
            
            // Format 12-hour time if needed, but assuming react sends formatted string or simple HH:MM
            // React app seems to save "10:00" (HH:MM). I can try to format it here or keep it simple.
            // Let's keep it simple for now as HH:MM is readable.

            String progressText = actual + "/" + planned + " min";
            views.setTextViewText(R.id.widget_subject_kpi, progressText);

            // Color logic could go here, but RemoteViews is limited. 
            // We set basic colors in XML. Here we can toggle visibility or simple color changes if needed.
            
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
