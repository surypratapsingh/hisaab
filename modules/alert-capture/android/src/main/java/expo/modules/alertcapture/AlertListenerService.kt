package expo.modules.alertcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * Sees the notifications of the apps that carry a person's own money alerts (messages, UPI
 * and bank apps) and keeps only the ones that talk about money: an amount in rupees, or a
 * debit/credit. Those are appended to a queue file in the app's private storage and read by
 * the app when it next opens. Nothing is sent anywhere.
 *
 * Every other app is ignored before its text is even read. A chat, social or shopping app
 * says "paid" and "₹" too, but what it shows is other people's conversation, which has no
 * place in a ledger.
 */
class AlertListenerService : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName == packageName) return
    if (sbn.packageName !in FINANCIAL_APPS) return
    val notification = sbn.notification ?: return
    // A group summary repeats its children's text.
    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

    val extras = notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: return

    val combined = listOfNotNull(title, text).joinToString(" ")
    if (!MONEY.containsMatchIn(combined)) return

    // Apps re-post the same notification when they update it.
    val fingerprint = "${sbn.packageName}|$combined"
    synchronized(recent) {
      if (recent.contains(fingerprint)) return
      recent.addLast(fingerprint)
      if (recent.size > 50) recent.removeFirst()
    }

    val line = JSONObject()
      .put("app", sbn.packageName)
      .put("title", title ?: JSONObject.NULL)
      .put("text", text)
      .put("postedAt", Instant.ofEpochMilli(sbn.postTime).toString())
      .toString()

    AlertQueue.append(queueFile(this), line)
  }

  companion object {
    /**
     * The apps whose notifications are read. Money alerts arrive as SMS, or from a UPI or
     * bank app. A bank app that is not listed here is not read: add its package name.
     */
    val FINANCIAL_APPS = setOf(
      // Messages (bank and UPI alerts are SMS)
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.android.mms",
      "com.android.messaging",
      "com.oneplus.mms",
      "com.motorola.messaging",
      // UPI and wallet apps
      "com.google.android.apps.nbu.paisa.user",
      "com.phonepe.app",
      "net.one97.paytm",
      "in.org.npci.upiapp",
      "com.samsung.android.spay",
      "com.dreamplug.androidapp",
      "com.mobikwik_new",
      "com.freecharge.android",
      "com.bharatpe.app",
      // Bank apps
      "com.infrasoft.uboi",
      "com.sbi.lotusintouch",
      "com.sbi.SBIFreedomPlus",
      "com.snapwork.hdfc",
      "com.csam.icici.bank.imobile",
      "com.axis.mobile",
      "com.msf.kbank.mobile",
      "com.fss.pnbone",
      "com.canarabank.mobility",
      "com.bankofbaroda.mconnect",
    )

    /** Rupee amounts, or the words banks use for money moving. */
    val MONEY = Regex(
      """(?i)(₹|\brs\.?\s?\d|\binr\s?\d|\b(debited|credited|withdrawn|spent|paid|received)\b)"""
    )

    private val recent = ArrayDeque<String>()

    fun queueFile(context: android.content.Context): File =
      File(context.filesDir, "captured_alerts.jsonl")
  }
}

/** One JSON object per line; drained whole by the app. */
object AlertQueue {
  private val lock = Any()

  fun append(file: File, line: String) {
    synchronized(lock) {
      file.appendText(line.replace("\n", " ") + "\n")
    }
  }

  /** Everything queued so far, removed from the queue in the same step. */
  fun drain(file: File): List<String> {
    synchronized(lock) {
      if (!file.exists()) return emptyList()
      val lines = file.readLines().filter { it.isNotBlank() }
      file.writeText("")
      return lines
    }
  }
}
