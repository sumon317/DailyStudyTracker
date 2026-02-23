package com.sumon.studytracker;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WidgetDataPlugin.class);
        registerPlugin(NativeAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
