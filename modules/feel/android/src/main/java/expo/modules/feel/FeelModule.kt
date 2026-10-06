package expo.modules.feel

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

private const val SAMPLE_RATE = 44_100

/** One note of a sound: a sine (plus a quiet octave above) that starts sharply and fades. */
private data class Note(
  val hz: Double,
  val startMs: Int,
  val lengthMs: Int,
  val gain: Double,
  /** How fast it fades: the time, in ms, for the note to fall to about a third of its start. */
  val decayMs: Double,
  val overtone: Double = 0.0,
)

/**
 * The whole sound vocabulary. Every sound is a few notes, well under half a second, made here at
 * run time: no audio files to ship, and nothing loud (each is mixed to a fraction of full scale).
 */
private val SOUNDS: Map<String, List<Note>> = mapOf(
  // Almost nothing: a fingertip on glass.
  "tap" to listOf(Note(1760.0, 0, 16, 0.10, 6.0)),
  // "Done": one short bright tick.
  "success" to listOf(Note(1318.5, 0, 52, 0.20, 14.0, 0.25)),
  // Money in: a soft two-note rise, C5 then G5.
  "moneyIn" to listOf(
    Note(523.25, 0, 130, 0.24, 55.0, 0.15),
    Note(783.99, 85, 240, 0.26, 95.0, 0.15),
  ),
  // Money out: one low, quiet note.
  "moneyOut" to listOf(Note(329.63, 0, 120, 0.17, 42.0, 0.10)),
  // Saved: one warm tone, A4 with its octave.
  "save" to listOf(Note(440.0, 0, 300, 0.24, 120.0, 0.35)),
  // A milestone: C5, E5, G5, then a held top note.
  "milestone" to listOf(
    Note(523.25, 0, 150, 0.22, 60.0, 0.15),
    Note(659.25, 95, 150, 0.22, 60.0, 0.15),
    Note(783.99, 190, 380, 0.26, 150.0, 0.2),
  ),
  // Something did not work: short, low, muted.
  "error" to listOf(Note(196.0, 0, 150, 0.20, 55.0, 0.30)),
)

/** Sounds are made once and kept. */
private val rendered = HashMap<String, ShortArray>()

private fun render(notes: List<Note>): ShortArray {
  val totalMs = notes.maxOf { it.startMs + it.lengthMs }
  val mix = DoubleArray(totalMs * SAMPLE_RATE / 1000)
  for (note in notes) {
    val from = note.startMs * SAMPLE_RATE / 1000
    val length = note.lengthMs * SAMPLE_RATE / 1000
    for (i in 0 until length) {
      val seconds = i.toDouble() / SAMPLE_RATE
      // 4 ms in and 6 ms out, so no note starts or ends with a click.
      val attack = min(1.0, i / (0.004 * SAMPLE_RATE))
      val release = min(1.0, (length - i) / (0.006 * SAMPLE_RATE))
      val fade = exp(-seconds * 1000.0 / note.decayMs)
      val wave = sin(2 * PI * note.hz * seconds) + note.overtone * sin(4 * PI * note.hz * seconds)
      if (from + i < mix.size) mix[from + i] += note.gain * attack * release * fade * wave
    }
  }
  return ShortArray(mix.size) { (mix[it].coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort() }
}

/**
 * Small haptic and sound cues for the motion system. The rules are kept here on the phone's side
 * so they cannot be got round: nothing plays when the phone's ringer is silent or on vibrate, and
 * a haptic obeys the phone's own "touch feedback" setting. JavaScript decides when (and how often)
 * a cue is worth playing; this only plays it.
 */
class FeelModule : Module() {
  private val player = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("Feel")

    OnDestroy { player.shutdownNow() }

    /** kind: light, medium, success, milestone, warning. */
    Function("haptic") { kind: String ->
      runCatching { vibrate(kind) }
    }

    /** name: tap, success, moneyIn, moneyOut, save, milestone, error. */
    Function("tone") { name: String ->
      runCatching { sound(name) }
    }
  }

  private fun vibrator(): Vibrator? {
    val context = appContext.reactContext ?: return null
    return if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
  }

  private fun effectFor(kind: String): VibrationEffect? {
    val predefined = Build.VERSION.SDK_INT >= 29
    return when (kind) {
      "light" ->
        if (predefined) VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
        else VibrationEffect.createOneShot(8, 40)
      "medium" ->
        if (predefined) VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
        else VibrationEffect.createOneShot(16, 110)
      // Two quick taps, the second firmer.
      "success" -> VibrationEffect.createWaveform(longArrayOf(0, 18, 55, 28), intArrayOf(0, 90, 0, 170), -1)
      // A rising three-tap.
      "milestone" ->
        VibrationEffect.createWaveform(longArrayOf(0, 20, 60, 26, 60, 46), intArrayOf(0, 80, 0, 140, 0, 230), -1)
      // Two firm, even taps: attention, not alarm.
      "warning" -> VibrationEffect.createWaveform(longArrayOf(0, 34, 70, 34), intArrayOf(0, 200, 0, 200), -1)
      else -> null
    }
  }

  private fun vibrate(kind: String) {
    val context = appContext.reactContext ?: return
    // The phone's "Touch feedback" switch turns all of this off.
    if (Settings.System.getInt(context.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) == 0) return
    val effect = effectFor(kind) ?: return
    val vibrator = vibrator() ?: return
    if (Build.VERSION.SDK_INT >= 33) {
      vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
    } else {
      vibrator.vibrate(effect)
    }
  }

  private fun sound(name: String) {
    val context = appContext.reactContext ?: return
    val notes = SOUNDS[name] ?: return
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    // Silent and vibrate both mean: no sound from this app.
    if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
    val pcm = synchronized(rendered) { rendered.getOrPut(name) { render(notes) } }

    player.execute {
      runCatching {
        val track = AudioTrack.Builder()
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build()
          )
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
              .build()
          )
          .setBufferSizeInBytes(pcm.size * 2)
          .setTransferMode(AudioTrack.MODE_STATIC)
          .build()
        track.write(pcm, 0, pcm.size)
        track.play()
        Thread.sleep(pcm.size * 1000L / SAMPLE_RATE + 60)
        track.release()
      }
    }
  }
}
