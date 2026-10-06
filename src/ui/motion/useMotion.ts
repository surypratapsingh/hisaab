import { useSyncExternalStore } from 'react';
import { allows, type MotionEffect, type MotionPrefs } from './policy';
import { getPrefs, isFollowingPhone, subscribePrefs } from './prefsState';

/** The motion, sound and haptics choices now in force; re-renders when they change. */
export const useMotionPrefs = (): MotionPrefs => useSyncExternalStore(subscribePrefs, getPrefs, getPrefs);

/** Whether a kind of movement is allowed right now, for code that is not a component. */
export const canMove = (effect: MotionEffect): boolean => allows(getPrefs().motion, effect);

/** `can('particles')` and so on, for a component. */
export const useMotion = (): { mode: MotionPrefs['motion']; can: (effect: MotionEffect) => boolean } => {
  const prefs = useMotionPrefs();
  return { mode: prefs.motion, can: (effect) => allows(prefs.motion, effect) };
};

/** Whether motion is Reduced only because the phone has animations turned off. */
export const useFollowingPhone = (): boolean => useSyncExternalStore(subscribePrefs, isFollowingPhone, isFollowingPhone);
