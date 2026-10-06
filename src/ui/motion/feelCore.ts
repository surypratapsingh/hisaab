import type { HapticKind, SoundName } from './tokens';
import { RewardBudget, type MotionPrefs } from './policy';
import type { Rule } from './moments';

/** What actually makes the buzz or the tone; returns false when this phone build cannot. */
export type FeelBackend = {
  haptic(kind: HapticKind): boolean;
  tone(name: SoundName): boolean;
};

const PAUSE_BETWEEN_HAPTICS = 140;

/**
 * The gate every haptic and sound goes through: the user's switches first, then
 * the reward budget. Nothing else in the app calls the backend directly.
 */
export const createFeel = (
  backend: FeelBackend,
  prefs: () => MotionPrefs,
  budget: RewardBudget = new RewardBudget(),
  wait: (ms: number, then: () => void) => void = (ms, then) => void setTimeout(then, ms)
) => {
  const haptic = (kind: HapticKind): boolean => {
    if (!prefs().haptics) return false;
    if (!budget.takeHaptic(kind)) return false;
    return backend.haptic(kind);
  };

  const sound = (name: SoundName, gapMs = 0): boolean => {
    if (!prefs().sound) return false;
    if (!budget.takeSound(name, gapMs)) return false;
    return backend.tone(name);
  };

  return {
    haptic,
    sound,

    /** The feel of one Money Moment, as its rule sets out. */
    forRule(rule: Rule): void {
      if (rule.haptic) {
        if (typeof rule.haptic === 'string') haptic(rule.haptic);
        else {
          const [first, second] = rule.haptic;
          haptic(first);
          // The second lands after the first has been felt; the budget's 120 ms spacing is met.
          wait(PAUSE_BETWEEN_HAPTICS, () => void haptic(second));
        }
      }
      if (rule.sound) sound(rule.sound, rule.soundGapMs);
    },

    /** Something did not work. Quiet and low, never alarming. */
    error(): void {
      haptic('warning');
      sound('error', 4000);
    },

    /** A destructive tap: a warning buzz, no sound. */
    warn(): void {
      haptic('warning');
    },

    /** A cinematic needs room; asks the budget. */
    cinematicAllowed: (): boolean => budget.takeCinematic(),
  };
};

export type Feel = ReturnType<typeof createFeel>;
