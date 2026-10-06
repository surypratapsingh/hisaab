import { requireOptionalNativeModule } from 'expo';

/** How hard a haptic taps, and what it says. */
export type HapticKind = 'light' | 'medium' | 'success' | 'milestone' | 'warning';

/** The whole sound vocabulary. Each is a fraction of a second, made on the phone. */
export type SoundName = 'tap' | 'success' | 'moneyIn' | 'moneyOut' | 'save' | 'milestone' | 'error';

type FeelNative = {
  haptic(kind: HapticKind): void;
  tone(name: SoundName): void;
};

/** Absent in Expo Go, on the web and in a build made before this module existed. */
const native = requireOptionalNativeModule<FeelNative>('Feel');

export const feelAvailable = native !== null && typeof native.haptic === 'function';

/**
 * Plays a haptic on the phone. Returns false when this build cannot (older build): the caller
 * may then use a plain buzz instead.
 */
export const playHaptic = (kind: HapticKind): boolean => {
  if (!feelAvailable) return false;
  native!.haptic(kind);
  return true;
};

/** Plays one of the short sounds. The phone stays silent in silent or vibrate mode. */
export const playTone = (name: SoundName): boolean => {
  if (!feelAvailable) return false;
  native!.tone(name);
  return true;
};
