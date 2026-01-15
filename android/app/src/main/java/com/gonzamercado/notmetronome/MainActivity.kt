package com.gonzamercado.notmetronome

import expo.modules.splashscreen.SplashScreenManager

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {

  private var audioManager: AudioManager? = null
  private var prevSystemVolume: Int? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)

    audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager

    // Optional: make hardware volume buttons control MUSIC (metronome), not SYSTEM.
    try {
      volumeControlStream = AudioManager.STREAM_MUSIC
    } catch (_: Throwable) {}

    // Best-effort: disable sound effects flags on the view tree.
    disableSoundEffectsNow()
  }

  override fun onResume() {
    super.onResume()
    // HARD guarantee: kill Android "touch sounds" while app is foreground.
    muteSystemUiSounds(true)

    // RN mounts views after onCreate; enforce again post-mount.
    disableSoundEffectsSoon()
  }

  override fun onPause() {
    // Restore user settings when leaving the app.
    muteSystemUiSounds(false)
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      // Re-enforce after focus (RN tree is usually ready here)
      disableSoundEffectsSoon()
      muteSystemUiSounds(true)
    }
  }

  private fun muteSystemUiSounds(enable: Boolean) {
    val am = audioManager ?: return
    try {
      if (enable) {
        if (prevSystemVolume == null) {
          prevSystemVolume = am.getStreamVolume(AudioManager.STREAM_SYSTEM)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0)
        } else {
          @Suppress("DEPRECATION")
          am.setStreamMute(AudioManager.STREAM_SYSTEM, true)
        }
      } else {
        val vol = prevSystemVolume
        if (vol != null) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0)
            am.setStreamVolume(AudioManager.STREAM_SYSTEM, vol, 0)
          } else {
            @Suppress("DEPRECATION")
            am.setStreamMute(AudioManager.STREAM_SYSTEM, false)
            am.setStreamVolume(AudioManager.STREAM_SYSTEM, vol, 0)
          }
        }
        prevSystemVolume = null
      }
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun disableSoundEffectsNow() {
    try {
      val root = window?.decorView ?: return
      root.isSoundEffectsEnabled = false
      root.setSoundEffectsEnabled(false)
      disableSoundEffectsRecursively(root)
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun disableSoundEffectsSoon() {
    try {
      val root = window?.decorView ?: return
      root.post { disableSoundEffectsNow() }
    } catch (_: Throwable) {
      // ignore
    }
  }

  private fun disableSoundEffectsRecursively(v: View) {
    try {
      v.isSoundEffectsEnabled = false
      v.setSoundEffectsEnabled(false)
    } catch (_: Throwable) {
      // ignore
    }
    if (v is ViewGroup) {
      for (i in 0 until v.childCount) {
        val child = v.getChildAt(i)
        if (child != null) disableSoundEffectsRecursively(child)
      }
    }
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(
        this,
        mainComponentName,
        fabricEnabled
      ) {}
    )
  }

  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
