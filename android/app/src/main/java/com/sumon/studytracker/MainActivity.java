package com.sumon.studytracker;

import com.getcapacitor.BridgeActivity;
import com.sumon.studytracker.alarm.NativeAlarmPlugin;
import com.sumon.studytracker.update.AppUpdatePlugin;
import com.sumon.studytracker.widget.WidgetDataPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WidgetDataPlugin.class);
        registerPlugin(NativeAlarmPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
