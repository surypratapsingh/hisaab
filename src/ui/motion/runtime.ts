import { Vibration } from 'react-native';
import { playHaptic, playTone } from '../../../modules/feel';
import { createFeel } from './feelCore';
import { getPrefs } from './prefsState';
import type { HapticKind } from './tokens';

/** A plain buzz for a build that predates the native haptics: the same rhythm, one strength. */
const BUZZ: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 16,
  success: [0, 18, 55, 28],
  milestone: [0, 20, 60, 26, 60, 46],
  warning: [0, 34, 70, 34],
};

/**
 * The one place Hisaab touches the phone's vibration motor and speaker.
 * Everything goes through the user's switches and the reward budget.
 */
export const feel = createFeel(
  {
    haptic: (kind) => {
      if (playHaptic(kind)) return true;
      Vibration.vibrate(BUZZ[kind]);
      return true;
    },
    tone: (name) => playTone(name),
  },
  getPrefs
);
