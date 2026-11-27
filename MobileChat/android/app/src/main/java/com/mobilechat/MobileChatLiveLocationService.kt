package com.mobilechat

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class MobileChatLiveLocationService : Service() {
  private data class ShareSession(
    val roomId: String,
    val sessionId: String,
    val expiresAt: Long,
    val accessToken: String,
  )

  companion object {
    const val ACTION_START = "com.mobilechat.action.START_LIVE_LOCATION"
    const val ACTION_STOP = "com.mobilechat.action.STOP_LIVE_LOCATION"
    const val EXTRA_ROOM_ID = "roomId"
    const val EXTRA_SESSION_ID = "sessionId"
    const val EXTRA_EXPIRES_AT = "expiresAt"
    const val EXTRA_ACCESS_TOKEN = "accessToken"
    const val EXTRA_NOTIFY_SERVER = "notifyServer"
    private const val CHANNEL_ID = "mobilechat_live_location"
    private const val NOTIFICATION_ID = 7314
    private const val API_BASE = "https://login.sof.com.vn/mobilechat-api/api/chat/live-location/"
  }

  private val activeSessions = linkedMapOf<String, ShareSession>()
  private val expiryCallbacks = mutableMapOf<String, Runnable>()
  private val networkExecutor = Executors.newSingleThreadExecutor()
  private lateinit var mainHandler: Handler
  private lateinit var locationManager: LocationManager
  private var locationListener: LocationListener? = null
  private var lastUpdateAt = 0L

  override fun onCreate() {
    super.onCreate()
    mainHandler = Handler(Looper.getMainLooper())
    locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> startSession(intent)
      ACTION_STOP -> stopRequestedSession(
        intent.getStringExtra(EXTRA_SESSION_ID),
        intent.getBooleanExtra(EXTRA_NOTIFY_SERVER, true),
      )
    }
    return if (activeSessions.isEmpty()) START_NOT_STICKY else START_REDELIVER_INTENT
  }

  private fun startSession(intent: Intent) {
    val roomId = intent.getStringExtra(EXTRA_ROOM_ID).orEmpty()
    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
    val expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0L)
    val accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty()
    if (roomId.isBlank() || !sessionId.matches(Regex("^[A-Za-z0-9_-]{8,100}$"))
      || expiresAt <= System.currentTimeMillis() || accessToken.isBlank()) {
      stopIfEmpty()
      return
    }

    if (activeSessions.isEmpty()) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
          startForeground(NOTIFICATION_ID, buildNotification())
        }
      } catch (_: SecurityException) {
        stopSelf()
        return
      }
    }

    activeSessions[sessionId] = ShareSession(roomId, sessionId, expiresAt, accessToken)
    expiryCallbacks.remove(sessionId)?.let(mainHandler::removeCallbacks)
    val expiry = Runnable { stopRequestedSession(sessionId, true) }
    expiryCallbacks[sessionId] = expiry
    mainHandler.postDelayed(expiry, (expiresAt - System.currentTimeMillis()).coerceAtLeast(0L))
    updateNotification()
    if (locationListener == null) startLocationUpdates()
  }

  private fun startLocationUpdates() {
    val fineGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      stopRequestedSession(null, true)
      return
    }

    val providers = listOfNotNull(
      if (fineGranted) LocationManager.GPS_PROVIDER else null,
      LocationManager.NETWORK_PROVIDER,
    ).filter { provider -> try { locationManager.isProviderEnabled(provider) } catch (_: Exception) { false } }
    if (providers.isEmpty()) {
      stopRequestedSession(null, true)
      return
    }

    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        val now = System.currentTimeMillis()
        if (now - lastUpdateAt < 9000L) return
        lastUpdateAt = now
        activeSessions.values.toList().forEach { session ->
          if (now >= session.expiresAt) stopRequestedSession(session.sessionId, true)
          else networkExecutor.execute { sendLocationUpdate(session, location) }
        }
      }

      @Deprecated("Deprecated by Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
    }
    locationListener = listener
    try {
      providers.forEach { provider -> locationManager.requestLocationUpdates(provider, 10000L, 0f, listener, Looper.getMainLooper()) }
    } catch (_: SecurityException) {
      stopRequestedSession(null, true)
    } catch (_: Exception) {
      stopRequestedSession(null, true)
    }
  }

  private fun sendLocationUpdate(session: ShareSession, location: Location) {
    val encodedSessionId = URLEncoder.encode(session.sessionId, StandardCharsets.UTF_8.name())
    val encodedRoomId = URLEncoder.encode(session.roomId, StandardCharsets.UTF_8.name())
    val connection = URL("$API_BASE$encodedSessionId?roomId=$encodedRoomId").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "PUT"
      connection.connectTimeout = 5000
      connection.readTimeout = 5000
      connection.setRequestProperty("Authorization", "Bearer ${session.accessToken}")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.doOutput = true
      val payload = JSONObject()
        .put("latitude", location.latitude)
        .put("longitude", location.longitude)
      if (location.hasAccuracy()) payload.put("accuracy", location.accuracy.toDouble())
      connection.outputStream.bufferedWriter().use { it.write(payload.toString()) }
      val status = connection.responseCode
      if (status == 401 || status == 403 || status == 404 || status == 409 || status == 410) {
        mainHandler.post { stopRequestedSession(session.sessionId, false) }
      }
    } catch (_: Exception) {
      // Temporary network errors are retried on the next location update.
    } finally {
      connection.disconnect()
    }
  }

  private fun stopRequestedSession(sessionId: String?, notifyServer: Boolean) {
    val sessionsToStop = if (sessionId.isNullOrBlank()) {
      activeSessions.values.toList()
    } else {
      listOfNotNull(activeSessions[sessionId])
    }
    sessionsToStop.forEach { session ->
      activeSessions.remove(session.sessionId)
      expiryCallbacks.remove(session.sessionId)?.let(mainHandler::removeCallbacks)
    }
    if (activeSessions.isEmpty()) stopLocationUpdates()
    if (notifyServer && sessionsToStop.isNotEmpty()) {
      updateNotification("Đang dừng chia sẻ vị trí…")
      networkExecutor.execute {
        sessionsToStop.forEach(::sendStopRequest)
        mainHandler.post {
          if (activeSessions.isEmpty()) finishService()
          else updateNotification()
        }
      }
    } else if (activeSessions.isEmpty()) {
      finishService()
    } else {
      updateNotification()
    }
  }

  private fun sendStopRequest(session: ShareSession) {
    val encodedSessionId = URLEncoder.encode(session.sessionId, StandardCharsets.UTF_8.name())
    val encodedRoomId = URLEncoder.encode(session.roomId, StandardCharsets.UTF_8.name())
    val connection = URL("$API_BASE$encodedSessionId/stop?roomId=$encodedRoomId").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 5000
      connection.readTimeout = 5000
      connection.setRequestProperty("Authorization", "Bearer ${session.accessToken}")
      connection.responseCode
    } catch (_: Exception) {
      // The backend expires a session by its stored timestamp even if stopping is offline.
    } finally {
      connection.disconnect()
    }
  }

  private fun stopLocationUpdates() {
    locationListener?.let { listener -> try { locationManager.removeUpdates(listener) } catch (_: Exception) { } }
    locationListener = null
  }

  private fun finishService() {
    stopLocationUpdates()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun stopIfEmpty() {
    if (activeSessions.isEmpty()) stopSelf()
  }

  private fun updateNotification(text: String? = null) {
    if (activeSessions.isEmpty()) return
    val notification = buildNotification(text)
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, notification)
  }

  private fun buildNotification(text: String? = null): Notification {
    val stopIntent = Intent(this, MobileChatLiveLocationService::class.java)
      .setAction(ACTION_STOP)
      .putExtra(EXTRA_NOTIFY_SERVER, true)
    val pendingIntent = PendingIntent.getService(
      this,
      NOTIFICATION_ID,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setContentTitle("MobileChat")
      .setContentText(text ?: if (activeSessions.size > 1) "Đang chia sẻ vị trí trực tiếp trong ${activeSessions.size} cuộc trò chuyện" else "Đang chia sẻ vị trí trực tiếp")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dừng chia sẻ", pendingIntent)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "Chia sẻ vị trí trực tiếp", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Hiển thị khi MobileChat đang chia sẻ vị trí trực tiếp"
    }
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
  }

  override fun onDestroy() {
    stopLocationUpdates()
    expiryCallbacks.values.forEach(mainHandler::removeCallbacks)
    expiryCallbacks.clear()
    networkExecutor.shutdown()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
