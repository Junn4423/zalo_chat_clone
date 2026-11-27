package com.mobilechat

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import androidx.core.content.ContextCompat

class MobileChatLocationModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "MobileChatLocation"

  @ReactMethod
  fun startLiveLocationService(roomId: String, sessionId: String, expiresAt: Double, accessToken: String, promise: Promise) {
    if (roomId.isBlank() || sessionId.isBlank() || accessToken.isBlank() || expiresAt <= System.currentTimeMillis()) {
      promise.reject("E_LIVE_LOCATION_ARGUMENTS", "Live location session information is incomplete")
      return
    }
    val fineGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      promise.reject("E_LOCATION_PERMISSION", "Location permission has not been granted")
      return
    }
    val locationManager = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val providerEnabled = listOfNotNull(
      if (fineGranted) LocationManager.GPS_PROVIDER else null,
      LocationManager.NETWORK_PROVIDER,
    ).any { provider -> try { locationManager.isProviderEnabled(provider) } catch (_: Exception) { false } }
    if (!providerEnabled) {
      promise.reject("E_LOCATION_UNAVAILABLE", "No location provider is enabled")
      return
    }
    try {
      val intent = Intent(reactApplicationContext, MobileChatLiveLocationService::class.java)
        .setAction(MobileChatLiveLocationService.ACTION_START)
        .putExtra(MobileChatLiveLocationService.EXTRA_ROOM_ID, roomId)
        .putExtra(MobileChatLiveLocationService.EXTRA_SESSION_ID, sessionId)
        .putExtra(MobileChatLiveLocationService.EXTRA_EXPIRES_AT, expiresAt.toLong())
        .putExtra(MobileChatLiveLocationService.EXTRA_ACCESS_TOKEN, accessToken)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(reactApplicationContext, intent)
      else reactApplicationContext.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_LIVE_LOCATION_SERVICE", error.message ?: "Could not start background location sharing", error)
    }
  }

  @ReactMethod
  fun stopLiveLocationService(sessionId: String, notifyServer: Boolean, promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, MobileChatLiveLocationService::class.java)
        .setAction(MobileChatLiveLocationService.ACTION_STOP)
        .putExtra(MobileChatLiveLocationService.EXTRA_SESSION_ID, sessionId)
        .putExtra(MobileChatLiveLocationService.EXTRA_NOTIFY_SERVER, notifyServer)
      reactApplicationContext.startService(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("E_LIVE_LOCATION_SERVICE", error.message ?: "Could not stop background location sharing", error)
    }
  }

  @ReactMethod
  fun getCurrentLocation(promise: Promise) {
    val fineGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      promise.reject("E_LOCATION_PERMISSION", "Location permission has not been granted")
      return
    }

    val manager = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val requestedProviders = listOfNotNull(if (fineGranted) LocationManager.GPS_PROVIDER else null, LocationManager.NETWORK_PROVIDER)
    val providers = requestedProviders.filter { provider ->
      try { manager.isProviderEnabled(provider) } catch (_: Exception) { false }
    }
    if (providers.isEmpty()) {
      promise.reject("E_LOCATION_UNAVAILABLE", "No location provider is enabled")
      return
    }

    try {
      val cached = providers.mapNotNull { provider ->
        try { manager.getLastKnownLocation(provider) } catch (_: SecurityException) { null }
      }.filter { location -> System.currentTimeMillis() - location.time <= 10 * 60 * 1000L }
        .minByOrNull { it.accuracy }
      if (cached != null) {
        resolveLocation(promise, cached)
        return
      }
    } catch (_: SecurityException) {
      promise.reject("E_LOCATION_PERMISSION", "Location permission is required")
      return
    }

    val handler = Handler(Looper.getMainLooper())
    var finished = false
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        if (finished) return
        finished = true
        providers.forEach { try { manager.removeUpdates(this) } catch (_: Exception) { } }
        handler.removeCallbacksAndMessages(null)
        resolveLocation(promise, location)
      }
      @Deprecated("Deprecated by Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
    }

    try {
      providers.forEach { provider -> manager.requestSingleUpdate(provider, listener, Looper.getMainLooper()) }
      handler.postDelayed({
        if (finished) return@postDelayed
        finished = true
        providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
        promise.reject("E_LOCATION_TIMEOUT", "Could not get a current location")
      }, 20000L)
    } catch (error: SecurityException) {
      finished = true
      providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
      promise.reject("E_LOCATION_PERMISSION", error.message ?: "Location permission is required", error)
    } catch (error: Exception) {
      finished = true
      providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
      promise.reject("E_LOCATION_UNAVAILABLE", error.message ?: "Could not get a current location", error)
    }
  }

  @ReactMethod
  fun getFreshLocation(promise: Promise) {
    val fineGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = reactApplicationContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      promise.reject("E_LOCATION_PERMISSION", "Location permission has not been granted")
      return
    }

    val manager = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val requestedProviders = listOfNotNull(if (fineGranted) LocationManager.GPS_PROVIDER else null, LocationManager.NETWORK_PROVIDER)
    val providers = requestedProviders.filter { provider ->
      try { manager.isProviderEnabled(provider) } catch (_: Exception) { false }
    }
    if (providers.isEmpty()) {
      promise.reject("E_LOCATION_UNAVAILABLE", "No location provider is enabled")
      return
    }

    val handler = Handler(Looper.getMainLooper())
    var finished = false
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        if (finished) return
        finished = true
        providers.forEach { try { manager.removeUpdates(this) } catch (_: Exception) { } }
        handler.removeCallbacksAndMessages(null)
        resolveLocation(promise, location)
      }
      @Deprecated("Deprecated by Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
    }

    try {
      providers.forEach { provider -> manager.requestSingleUpdate(provider, listener, Looper.getMainLooper()) }
      handler.postDelayed({
        if (finished) return@postDelayed
        finished = true
        providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
        promise.reject("E_LOCATION_TIMEOUT", "Could not get a fresh location")
      }, 20000L)
    } catch (error: SecurityException) {
      finished = true
      providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
      promise.reject("E_LOCATION_PERMISSION", error.message ?: "Location permission is required", error)
    } catch (error: Exception) {
      finished = true
      providers.forEach { try { manager.removeUpdates(listener) } catch (_: Exception) { } }
      promise.reject("E_LOCATION_UNAVAILABLE", error.message ?: "Could not get a fresh location", error)
    }
  }

  private fun resolveLocation(promise: Promise, location: Location) {
    promise.resolve(Arguments.createMap().apply {
      putDouble("latitude", location.latitude)
      putDouble("longitude", location.longitude)
      if (location.hasAccuracy()) putDouble("accuracy", location.accuracy.toDouble())
      putDouble("timestamp", location.time.toDouble())
    })
  }
}
