# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Capacitor plugins
-keep class com.getcapacitor.** { *; }
-keep class io.capawesome.capacitorjs.** { *; }

# Keep Dexie
-keep class dexie.** { *; }
-dontwarn dexie.**

# Keep jsPDF
-keep class com.** { *; }
-dontwarn com.**
-keep class jsPDF.** { *; }
-dontwarn jsPDF.**

# Keep notification handling
-keep class com.sumon.studytracker.** { *; }

# Keep alarm receiver
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.app.Service

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

# Keep R8 rules for Kotlin
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes SourceFile,LineNumberTable

# Kotlin specific
-dontwarn kotlin.**
-keep class kotlin.** { *; }
-keepclassmembers class **$WhenMappings { *; }

# React Native
-keep class com.facebook.react.** { *; }
-dontwarn com.facebook.react.**

# Framer Motion (keep animation classes)
-keep class com.facebook.fresco.** { *; }
