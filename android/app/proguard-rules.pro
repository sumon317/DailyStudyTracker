# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# The release build runs R8 in full mode, so anything reached only by
# reflection or by the Android framework has to be named here explicitly.
# There is no React Native, no Kotlin source set and no JS-to-Java bridge in
# this project, so the React Native and JS library rules that the default
# template shipped with have been removed.

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep the Capacitor bridge and the plugins it resolves by annotation
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# Keep the Android foreground service plugin (declared in AndroidManifest.xml as
# io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService and
# .NotificationActionBroadcastReceiver)
-keep class io.capawesome.capacitorjs.** { *; }

# Keep this app's alarm receivers/activities, the focus stopwatch service, the
# home-screen widget provider/RemoteViews service and the custom Capacitor
# plugins (NativeAlarmPlugin, WidgetDataPlugin, AppUpdatePlugin). The framework
# instantiates all of them by name from the manifest or from an Intent. The
# blanket rule also covers the package-private helpers the widget package shares
# internally (WidgetTimeUtils, WidgetTheme, the RemoteViewsFactory), and the
# RemoteViews reflection targets themselves are framework methods that R8 never
# renames, so setInt(..., "setBackgroundResource", ...) and friends stay valid.
-keep class com.sumon.studytracker.** { *; }
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.app.Service
-keep class * extends android.widget.RemoteViewsService$RemoteViewsFactory { *; }

# Keep the FileProvider subclass used to hand over exported backups
-keep class androidx.core.content.FileProvider { *; }

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
}

# Obfuscate
-verbose

# Keep R8 rules for annotations. These are still required: the Capacitor
# plugin bridge resolves the widget data plugin by @CapacitorPlugin.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes SourceFile,LineNumberTable

# Kotlin runtime rules are retained even though this module has no Kotlin
# sources, because Gradle can still put kotlin-stdlib on the release
# classpath transitively and the release build cannot be verified in CI
# without a signing key.
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings { *; }
