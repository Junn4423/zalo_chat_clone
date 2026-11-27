package com.mobilechat

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class VoiceRecorderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "MobileChatVoiceRecorder"
    private const val MIN_DURATION_MS = 700L
  }

  private var recorder: MediaRecorder? = null
  private var outputFile: File? = null
  private var startedAtMs: Long = 0L

  override fun getName(): String = NAME

  @ReactMethod
  fun startRecording(promise: Promise) {
    if (recorder != null) {
      promise.reject("E_RECORDING_ACTIVE", "A voice recording is already active")
      return
    }

    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
      reactApplicationContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_PERMISSION", "Microphone permission has not been granted")
      return
    }

    val file = File(reactApplicationContext.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
    val newRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaRecorder(reactApplicationContext)
    } else {
      @Suppress("DEPRECATION")
      MediaRecorder()
    }

    try {
      newRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
      newRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      newRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      newRecorder.setAudioChannels(1)
      newRecorder.setAudioSamplingRate(44100)
      newRecorder.setAudioEncodingBitRate(96000)
      newRecorder.setOutputFile(file.absolutePath)
      newRecorder.prepare()
      newRecorder.start()

      recorder = newRecorder
      outputFile = file
      startedAtMs = SystemClock.elapsedRealtime()
      promise.resolve(true)
    } catch (error: Exception) {
      try { newRecorder.release() } catch (_: Exception) { }
      file.delete()
      promise.reject("E_RECORDING_START", error.message ?: "Could not start voice recording", error)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    val activeRecorder = recorder
    val file = outputFile
    val durationMs = (SystemClock.elapsedRealtime() - startedAtMs).coerceAtLeast(0L)
    recorder = null
    outputFile = null
    startedAtMs = 0L

    if (activeRecorder == null || file == null) {
      promise.reject("E_NOT_RECORDING", "There is no active voice recording")
      return
    }

    try {
      activeRecorder.stop()
    } catch (error: Exception) {
      try { activeRecorder.release() } catch (_: Exception) { }
      file.delete()
      promise.reject("E_RECORDING_STOP", error.message ?: "Could not finish voice recording", error)
      return
    }
    try { activeRecorder.release() } catch (_: Exception) { }

    if (durationMs < MIN_DURATION_MS || !file.exists() || file.length() == 0L) {
      file.delete()
      promise.reject("E_RECORDING_TOO_SHORT", "Record for at least a second before sending")
      return
    }

    val result = Arguments.createMap().apply {
      putString("uri", Uri.fromFile(file).toString())
      putString("fileName", file.name)
      putString("type", "audio/mp4")
      putDouble("duration", durationMs / 1000.0)
      putDouble("fileSize", file.length().toDouble())
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun cancelRecording(promise: Promise) {
    val file = outputFile
    val activeRecorder = recorder
    recorder = null
    outputFile = null
    startedAtMs = 0L

    try { activeRecorder?.reset() } catch (_: Exception) { }
    try { activeRecorder?.release() } catch (_: Exception) { }
    file?.delete()
    promise.resolve(true)
  }
}
