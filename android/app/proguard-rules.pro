# ProGuard / R8 Rules for 3SAJ Studio App

# React Native Core & JNI
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.soloader.** { *; }

# React Native Native Methods
-keepclassmembers class * {
    native <methods>;
}

# React Native Reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
   public <methods>;
}

# FFmpegKit
-keep class com.arthenica.ffmpegkit.** { *; }
-dontwarn com.arthenica.ffmpegkit.**

# Expo SQLite & Requery SQLite bindings
-keep class expo.modules.sqlite.** { *; }
-keep class io.requery.android.database.sqlite.** { *; }
-dontwarn io.requery.android.database.sqlite.**

# Expo Modules Core & Modules Autolinking
-keep class expo.modules.** { *; }
-keep class expo.modules.kotlin.** { *; }
-keep class * extends expo.modules.kotlin.modules.Module { *; }
-keepclassmembers class * extends expo.modules.kotlin.modules.Module {
    public <methods>;
}

# React Native Screens, Safe Area Context, Gesture Handler, SVG
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }
-keep class com.horcrux.svg.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# Expo Splash Screen
-keep class expo.modules.splashscreen.** { *; }

# Expo AV (Audio & Video) & ExoPlayer
-keep class expo.modules.av.** { *; }
-keep class expo.modules.av.player.** { *; }
-keep class expo.modules.av.video.** { *; }
-keepclassmembers class expo.modules.av.** {
    public <methods>;
}
-dontwarn expo.modules.av.**
-keep class com.google.android.exoplayer2.** { *; }
-dontwarn com.google.android.exoplayer2.**
