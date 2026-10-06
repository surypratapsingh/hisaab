package expo.modules.intake

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tiles: pull down the notification shade (or from the lock screen) and tap
 * "Scan and pay" or "Add purchase" to open Hisaab on the scanner or that form.
 *
 * A tile does exactly what the matching launcher shortcut does: it opens MainActivity with the
 * same action, which only asks for the scanner or a blank form. On a locked phone Android asks
 * for the phone's own unlock first, and a released build then asks for the app lock as well.
 * Only the system can bind a tile (BIND_QUICK_SETTINGS_TILE in the manifest).
 */
abstract class FormTile(private val action: String) : TileService() {
  override fun onStartListening() {
    qsTile?.apply {
      state = Tile.STATE_INACTIVE
      updateTile()
    }
  }

  override fun onClick() {
    val intent = Intent(action)
      .setClassName(packageName, "$packageName.MainActivity")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val open = Runnable {
      if (Build.VERSION.SDK_INT >= 34) {
        val pending = PendingIntent.getActivity(
          this,
          action.hashCode(),
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        startActivityAndCollapse(pending)
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    }
    if (isLocked) unlockAndRun(open) else open.run()
  }
}

class ScanPayTile : FormTile("com.surya.moneyos.action.SCAN_PAY")

class AddPurchaseTile : FormTile("com.surya.moneyos.action.ADD_PURCHASE")
