import { DEFAULT_PREFS, prefsFromSettings, type MotionPrefs } from './policy';

/**
 * The current motion, sound and haptics choices, held outside React so the
 * haptics gate and the animations read the same answer. The store writes what
 * the user chose (or nothing); the phone's own "remove animations" setting is
 * applied on top of an unmade choice.
 */

type Stored = { motion: string | null; sound: string | null; haptics: string | null };

let stored: Stored = { motion: null, sound: null, haptics: null };
let phoneWantsLess = false;
let prefs: MotionPrefs = DEFAULT_PREFS;
let following = false;
const listeners = new Set<() => void>();

const isChoice = (value: string | null | undefined): boolean => value === 'full' || value === 'reduced' || value === 'none';

const recompute = (): void => {
  const next = prefsFromSettings(stored, phoneWantsLess);
  const nowFollowing = phoneWantsLess && !isChoice(stored.motion);
  if (
    next.motion === prefs.motion &&
    next.sound === prefs.sound &&
    next.haptics === prefs.haptics &&
    nowFollowing === following
  ) {
    return;
  }
  prefs = next;
  following = nowFollowing;
  for (const listener of listeners) listener();
};

export const getPrefs = (): MotionPrefs => prefs;

/** True when motion is Reduced only because the phone asks for less and no choice was made. */
export const isFollowingPhone = (): boolean => following;

export const applyStored = (next: Stored): void => {
  stored = next;
  recompute();
};

export const applyPhone = (wantsLess: boolean): void => {
  phoneWantsLess = wantsLess;
  recompute();
};

export const subscribePrefs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
