package expo.modules.alertcapture

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript side of alert capture: is notification access on, open the
 * settings screen where the user turns it on, and hand over what was caught.
 */
class AlertCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AlertCapture")

    Function("isEnabled") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // The system keeps enabled listeners as "package/Service:package/Service".
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      enabled.split(':').any { it.startsWith(context.packageName + "/") }
    }

    Function("openSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /**
     * SMS in the inbox received after `sinceMs`, oldest first, keeping only
     * those that mention money. Needs READ_SMS, which the app asks for first.
     * Read on the phone; nothing leaves it.
     */
    AsyncFunction("readInbox") { sinceMs: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val messages = mutableListOf<String>()
      context.contentResolver.query(
        android.net.Uri.parse("content://sms/inbox"),
        arrayOf("address", "body", "date"),
        "date > ?",
        arrayOf(sinceMs.toLong().toString()),
        "date ASC"
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val address = cursor.getString(0) ?: ""
          val body = cursor.getString(1) ?: continue
          if (!AlertListenerService.MONEY.containsMatchIn(body)) continue
          messages.add(
            org.json.JSONObject()
              .put("app", "sms")
              .put("sender", address)
              .put("title", address)
              .put("text", body.replace("\n", " "))
              .put("postedAt", java.time.Instant.ofEpochMilli(cursor.getLong(2)).toString())
              .toString()
          )
        }
      }
      messages
    }

    /** Queued alerts as JSON strings, oldest first; the queue is emptied. */
    Function("drain") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      AlertQueue.drain(AlertListenerService.queueFile(context))
    }
  }
}
