package expo.modules.intake

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** The largest statement or export read as text. Anything bigger is refused, not loaded. */
private const val MAX_TEXT_BYTES = 25 * 1024 * 1024
private const val MAX_SHARED_TEXT = 20_000

/** Asks the phone's own camera app for one photo. */
private const val TAKE_PHOTO_CODE = 4139

/** A payment link handed to the phone's UPI apps, and its answer. */
private const val PAY_CODE = 4140

/** What the launcher shortcuts ask for. Any other action is ignored. */
private const val ACTION_ADD_PURCHASE = "com.surya.moneyos.action.ADD_PURCHASE"
private const val ACTION_ADD_TRANSACTION = "com.surya.moneyos.action.ADD_TRANSACTION"
private const val ACTION_SCAN_PAY = "com.surya.moneyos.action.SCAN_PAY"

class UnreadableFileException(cause: Throwable?) :
  CodedException("ERR_INTAKE_UNREADABLE", "This file could not be read", cause)

class ScannerUnavailableException(cause: Throwable?) :
  CodedException("ERR_INTAKE_NO_SCANNER", "The code scanner could not be opened", cause)

class UpiAppUnavailableException(cause: Throwable?) :
  CodedException("ERR_INTAKE_NO_UPI_APP", "No UPI app could be opened", cause)

class UpiBusyException :
  CodedException("ERR_INTAKE_UPI_BUSY", "A UPI app is already open for a payment", null)

class NotAPaymentLinkException :
  CodedException("ERR_INTAKE_NOT_PAYMENT", "Only a payment link can be handed to a UPI app", null)

class CameraUnavailableException(cause: Throwable?) :
  CodedException("ERR_INTAKE_NO_CAMERA", "No camera app could be opened", cause)

class CameraBusyException :
  CodedException("ERR_INTAKE_CAMERA_BUSY", "The camera is already open", null)

/**
 * Files other apps share to Hisaab, text read from bill photos, the launcher
 * shortcuts, a photo taken with the phone's own camera app, and a payment code scanned
 * and handed to a UPI app. All of it stays on the phone: sharing hands over a file the user
 * chose, ML Kit's bundled model recognises text without a network call, a shortcut only asks
 * for a blank form, the camera app writes one picture into a private folder of ours, and the
 * code scanner is Google Play services' own screen (it returns only the text of the code), so
 * Hisaab itself needs no camera permission. Hisaab never moves money: it opens a UPI app.
 */
class IntakeModule : Module() {
  /** The share that launched the app, until JavaScript takes it. */
  private var pending: Intent? = null

  /** The launcher shortcut that opened the app ("purchase" or "transaction"), until JavaScript takes it. */
  private var pendingShortcut: String? = null

  /** The camera's answer is owed here, and the file it was asked to write. */
  private var pendingPhoto: Promise? = null
  private var photoFile: File? = null

  /** A UPI app's answer is owed here. */
  private var pendingUpi: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("Intake")
    Events("onShare", "onShortcut")

    OnCreate {
      pending = appContext.currentActivity?.intent?.takeIf { isShare(it) }
      pendingShortcut = shortcutOf(appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      if (isShare(intent)) {
        pending = intent
        sharedFile(intent)?.let { sendEvent("onShare", it) }
      }
      shortcutOf(intent)?.let {
        pendingShortcut = it
        sendEvent("onShortcut", mapOf("name" to it))
      }
    }

    /**
     * Opens the phone's camera app for one picture and resolves with the picture's file:// address,
     * or null if the user backs out. The camera writes into a private folder through a provider
     * that is not exported; the file is the app's to move or delete.
     */
    AsyncFunction("takePhoto") { promise: Promise ->
      if (pendingPhoto != null) throw CameraBusyException()
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val folder = File(context.cacheDir, "captures").apply { mkdirs() }
      val file = File(folder, "photo-${System.currentTimeMillis()}.jpg")
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.capture", file)
      val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
        putExtra(MediaStore.EXTRA_OUTPUT, uri)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      pendingPhoto = promise
      photoFile = file
      try {
        appContext.throwingActivity.startActivityForResult(intent, TAKE_PHOTO_CODE)
      } catch (e: ActivityNotFoundException) {
        pendingPhoto = null
        photoFile = null
        throw CameraUnavailableException(e)
      }
    }

    /**
     * Opens Google Play services' own code scanner, which shows the camera itself and needs no
     * camera permission from us, for one QR code. Resolves with the code's text, or null if the
     * user backs out. Only the text comes back; no image reaches Hisaab.
     */
    AsyncFunction("scanCode") { promise: Promise ->
      val activity = appContext.throwingActivity
      val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .build()
      GmsBarcodeScanning.getClient(activity, options)
        .startScan()
        .addOnSuccessListener { barcode -> promise.resolve(barcode.rawValue ?: "") }
        .addOnCanceledListener { promise.resolve(null) }
        .addOnFailureListener { e -> promise.reject(ScannerUnavailableException(e)) }
    }

    /**
     * Hands a payment link to the phone's UPI apps (the system offers the ones installed) and
     * resolves with whatever the app said as it closed, e.g. "txnId=…&responseCode=00&Status=SUCCESS",
     * or "" if it said nothing. That is the other app's word, not proof: the caller treats it as a note.
     * Only a link Hisaab built itself, starting "upi://pay?", is handed on.
     */
    AsyncFunction("openUpi") { link: String, promise: Promise ->
      if (!link.startsWith("upi://pay?")) throw NotAPaymentLinkException()
      if (pendingUpi != null) throw UpiBusyException()
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link))
      pendingUpi = promise
      try {
        appContext.throwingActivity.startActivityForResult(Intent.createChooser(intent, "Pay with"), PAY_CODE)
      } catch (e: ActivityNotFoundException) {
        pendingUpi = null
        throw UpiAppUnavailableException(e)
      }
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode == PAY_CODE) {
        val answer = pendingUpi ?: return@OnActivityResult
        pendingUpi = null
        // Most UPI apps answer in "response"; some in "Status".
        answer.resolve(data?.getStringExtra("response") ?: data?.getStringExtra("Status") ?: "")
        return@OnActivityResult
      }
      if (requestCode != TAKE_PHOTO_CODE) return@OnActivityResult
      val promise = pendingPhoto ?: return@OnActivityResult
      val file = photoFile
      pendingPhoto = null
      photoFile = null
      if (resultCode == Activity.RESULT_OK && file != null && file.length() > 0) {
        promise.resolve(Uri.fromFile(file).toString())
      } else {
        file?.delete()
        promise.resolve(null)
      }
    }

    /** The shortcut the app was opened with, once; null if none. */
    Function("takeShortcut") {
      val activity = appContext.currentActivity
      val name = pendingShortcut ?: shortcutOf(activity?.intent)
      pendingShortcut = null
      // Clear it from the activity too, so turning the phone or returning does not reopen the form.
      if (shortcutOf(activity?.intent) != null) activity?.intent?.action = Intent.ACTION_MAIN
      name
    }

    /** The shared file the app was opened with, once; null if none. */
    Function("takeShared") {
      val intent = pending ?: appContext.currentActivity?.intent?.takeIf { isShare(it) }
      pending = null
      // Clear it from the activity too, so returning to the app does not re-share.
      appContext.currentActivity?.intent?.takeIf { isShare(it) }?.action = Intent.ACTION_MAIN
      intent?.let { sharedFile(it) }
    }

    AsyncFunction("readText") { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val target = Uri.parse(uri)
      // Only what another app has handed over through the system. A file:// address could
      // point at the app's own private files.
      if (target.scheme != "content") throw UnreadableFileException(null)
      try {
        context.contentResolver.openInputStream(target)?.use { readBounded(it) }
          ?: throw UnreadableFileException(null)
      } catch (e: CodedException) {
        throw e
      } catch (e: Exception) {
        throw UnreadableFileException(e)
      }
    }

    /**
     * Text in a photo, line by line with each line's box, as JSON:
     * [{"text": "...", "box": [left, top, right, bottom]}]. The box lets the
     * bill reader pair an item's name with the price printed at its right.
     */
    AsyncFunction("recognizeText") { uri: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        throw UnreadableFileException(e)
      }
      TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        .process(image)
        .addOnSuccessListener { result ->
          val lines = JSONArray()
          for (block in result.textBlocks) {
            for (line in block.lines) {
              val box = line.boundingBox
              lines.put(
                JSONObject()
                  .put("text", line.text)
                  .put("box", JSONArray().put(box?.left ?: 0).put(box?.top ?: 0).put(box?.right ?: 0).put(box?.bottom ?: 0))
              )
            }
          }
          promise.resolve(lines.toString())
        }
        .addOnFailureListener { e -> promise.reject(UnreadableFileException(e)) }
    }
  }

  private fun shortcutOf(intent: Intent?): String? =
    when (intent?.action) {
      ACTION_ADD_PURCHASE -> "purchase"
      ACTION_ADD_TRANSACTION -> "transaction"
      ACTION_SCAN_PAY -> "scan"
      else -> null
    }

  private fun isShare(intent: Intent): Boolean =
    intent.action == Intent.ACTION_SEND && (streamOf(intent) != null || sharedText(intent) != null)

  /** Text shared on its own (an SMS, a WhatsApp or email message), capped; null when a file came with it. */
  private fun sharedText(intent: Intent): String? {
    if (streamOf(intent) != null || intent.type?.startsWith("text/plain") != true) return null
    return intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.take(MAX_SHARED_TEXT)?.takeIf { it.isNotEmpty() }
  }

  /** The text of a stream, up to MAX_TEXT_BYTES; a bigger file is refused rather than loaded whole. */
  private fun readBounded(input: java.io.InputStream): String {
    val out = ByteArrayOutputStream()
    val chunk = ByteArray(64 * 1024)
    var total = 0
    while (true) {
      val read = input.read(chunk)
      if (read < 0) break
      total += read
      if (total > MAX_TEXT_BYTES) throw UnreadableFileException(null)
      out.write(chunk, 0, read)
    }
    return out.toString(Charsets.UTF_8.name())
  }

  /** A share carries a content:// address the sender granted access to; anything else is ignored. */
  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.takeIf { it.scheme == "content" }

  private fun sharedFile(intent: Intent): Map<String, String?>? {
    sharedText(intent)?.let { text ->
      return mapOf(
        "uri" to "",
        "mimeType" to "text/plain",
        "name" to (intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "shared text"),
        "text" to text,
      )
    }
    val uri = streamOf(intent) ?: return null
    val context = appContext.reactContext ?: return null
    var name: String? = null
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) name = cursor.getString(0)
    }
    return mapOf(
      "uri" to uri.toString(),
      "mimeType" to (intent.type ?: context.contentResolver.getType(uri)),
      "name" to (name ?: uri.lastPathSegment),
    )
  }
}
