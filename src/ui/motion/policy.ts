import type { HapticKind, SoundName } from './tokens';

/**
 * What the user allows (motion, sound, haptics) and how much delight the app
 * may spend. Kept free of React Native so the rules can be tested.
 */

export type MotionMode = 'full' | 'reduced' | 'none';

export type MotionPrefs = {
  motion: MotionMode;
  sound: boolean;
  haptics: boolean;
};

/** Kinds of movement, from the least to the most. */
export type MotionEffect = 'state' | 'fade' | 'amount' | 'travel' | 'particles' | 'orbit' | 'cinematic';

const ALLOWED: Record<MotionMode, readonly MotionEffect[]> = {
  // A change of state is always shown; nothing moves to show it.
  none: ['state'],
  // Fades and figures that settle; no particles, no large movement, no cinematics, no orbit.
  reduced: ['state', 'fade', 'amount'],
  full: ['state', 'fade', 'amount', 'travel', 'particles', 'orbit', 'cinematic'],
};

export const allows = (mode: MotionMode, effect: MotionEffect): boolean => ALLOWED[mode].includes(effect);

/**
 * What was chosen (stored text, or nothing) and whether the phone asks for
 * less motion. Choosing nothing follows the phone.
 */
export const resolveMotion = (stored: string | null | undefined, phoneWantsLess: boolean): MotionMode =>
  stored === 'full' || stored === 'reduced' || stored === 'none' ? stored : phoneWantsLess ? 'reduced' : 'full';

/** Sound and haptics are on unless switched off. */
export const prefsFromSettings = (
  stored: { motion?: string | null; sound?: string | null; haptics?: string | null },
  phoneWantsLess: boolean
): MotionPrefs => ({
  motion: resolveMotion(stored.motion, phoneWantsLess),
  sound: stored.sound !== 'off',
  haptics: stored.haptics !== 'off',
});

export const DEFAULT_PREFS: MotionPrefs = { motion: 'full', sound: true, haptics: true };

// --------------------------------------------------------------- reward budget

const MINUTE = 60_000;

/**
 * The app may not celebrate everything. Sounds are spaced and capped, haptics
 * cannot chatter, and a cinematic cannot follow another straight away. Most
 * of the time the answer is "not now", which is the point: about 80% of what
 * happens should be calm.
 */
export class RewardBudget {
  private soundTimes: number[] = [];
  private soundByKind = new Map<string, number>();
  private hapticTimes: number[] = [];
  private cinematicAt = -Infinity;

  constructor(private readonly now: () => number = Date.now) {}

  /** A sound is spaced from any other, spaced from its own kind, and capped per ten minutes. */
  takeSound(kind: SoundName, gapMs = 0): boolean {
    const at = this.now();
    this.soundTimes = this.soundTimes.filter((t) => at - t < 10 * MINUTE);
    const last = this.soundTimes[this.soundTimes.length - 1];
    if (last !== undefined && at - last < 1200) return false;
    if (this.soundTimes.length >= 8) return false;
    const own = this.soundByKind.get(kind);
    if (own !== undefined && at - own < gapMs) return false;
    this.soundTimes.push(at);
    this.soundByKind.set(kind, at);
    return true;
  }

  /** A haptic cannot follow another within 120 ms, and stops at 30 a minute. */
  takeHaptic(_kind: HapticKind): boolean {
    const at = this.now();
    this.hapticTimes = this.hapticTimes.filter((t) => at - t < MINUTE);
    const last = this.hapticTimes[this.hapticTimes.length - 1];
    if (last !== undefined && at - last < 120) return false;
    if (this.hapticTimes.length >= 30) return false;
    this.hapticTimes.push(at);
    return true;
  }

  /** A cinematic needs 20 seconds since the last one. */
  takeCinematic(): boolean {
    const at = this.now();
    if (at - this.cinematicAt < 20_000) return false;
    this.cinematicAt = at;
    return true;
  }
}
