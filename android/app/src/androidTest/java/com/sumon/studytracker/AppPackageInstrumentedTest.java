package com.sumon.studytracker;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppPackageInstrumentedTest {

    @Test
    public void targetContextUsesApplicationPackage() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.sumon.studytracker", context.getPackageName());
    }
}
