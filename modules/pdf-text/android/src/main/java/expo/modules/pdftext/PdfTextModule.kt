package expo.modules.pdftext

import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

class PasswordRequiredException :
  CodedException("ERR_PDF_PASSWORD", "This PDF is protected with a password", null)

class WrongPasswordException :
  CodedException("ERR_PDF_WRONG_PASSWORD", "That password did not open the PDF", null)

class UnreadablePdfException(cause: Throwable?) :
  CodedException("ERR_PDF_UNREADABLE", "This file could not be read as a PDF", cause)

/**
 * Reads a statement PDF into lines of words, each with its horizontal extent,
 * on the phone. Nothing leaves the device. The layout goes to JavaScript as
 * JSON, where the statement parser lines words up under column headers.
 */
class PdfTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfText")

    AsyncFunction("extractLayout") { uri: String, password: String? ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      PDFBoxResourceLoader.init(context)

      val input = try {
        context.contentResolver.openInputStream(Uri.parse(uri))
      } catch (e: Exception) {
        throw UnreadablePdfException(e)
      } ?: throw UnreadablePdfException(null)

      input.use { stream ->
        val document = try {
          PDDocument.load(stream, password ?: "")
        } catch (e: InvalidPasswordException) {
          throw if (password.isNullOrEmpty()) PasswordRequiredException() else WrongPasswordException()
        } catch (e: Exception) {
          throw UnreadablePdfException(e)
        }

        document.use { doc ->
          val stripper = LayoutStripper()
          stripper.getText(doc)
          // Built by hand so "format" is always the first key: the parser
          // recognises a layout by that prefix.
          "{\"format\":\"pdf-layout\",\"version\":1,\"pages\":${doc.numberOfPages}," +
            "\"lines\":${stripper.lines}}"
        }
      }
    }
  }
}

/**
 * PDFTextStripper already groups glyphs into lines in reading order; this
 * keeps where each word started and ended instead of flattening to text.
 */
private class LayoutStripper : PDFTextStripper() {
  val lines = JSONArray()
  private var words = JSONArray()
  private var lineY = 0f

  init {
    sortByPosition = true
  }

  override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
    val word = StringBuilder()
    var first: TextPosition? = null
    var last: TextPosition? = null

    for (position in textPositions) {
      val glyph = position.unicode ?: continue
      if (glyph.isBlank()) {
        addWord(word, first, last)
        word.setLength(0)
        first = null
        last = null
        continue
      }
      if (first == null) first = position
      last = position
      word.append(glyph)
    }
    addWord(word, first, last)
  }

  private fun addWord(word: StringBuilder, first: TextPosition?, last: TextPosition?) {
    if (word.isEmpty() || first == null || last == null) return
    if (words.length() == 0) lineY = first.yDirAdj
    words.put(
      JSONArray()
        .put(tenth(first.xDirAdj))
        .put(tenth(last.xDirAdj + last.widthDirAdj))
        .put(word.toString())
    )
  }

  override fun writeLineSeparator() {
    if (words.length() > 0) {
      lines.put(
        JSONObject()
          .put("p", currentPageNo)
          .put("y", tenth(lineY))
          .put("w", words)
      )
    }
    words = JSONArray()
  }

  override fun writePageEnd() {
    writeLineSeparator()
    super.writePageEnd()
  }

  private fun tenth(value: Float): Double = (value * 10).roundToInt() / 10.0
}
