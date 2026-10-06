package expo.modules.intake

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Home-screen widget with two buttons, "Scan and pay" and "Add purchase". Each opens MainActivity
 * with the same action as the launcher shortcut and the Quick Settings tile, so it can only open
 * the scanner or a blank form, behind the app lock in a released build. It shows no amounts.
 */
class QuickWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val views = RemoteViews(context.packageName, R.layout.intake_quick_widget).apply {
      setOnClickPendingIntent(R.id.intake_widget_scan, open(context, "com.surya.moneyos.action.SCAN_PAY"))
      setOnClickPendingIntent(R.id.intake_widget_purchase, open(context, "com.surya.moneyos.action.ADD_PURCHASE"))
    }
    manager.updateAppWidget(ids, views)
  }

  private fun open(context: Context, action: String): PendingIntent {
    val intent = Intent(action)
      .setClassName(context.packageName, "${context.packageName}.MainActivity")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      action.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }
}
