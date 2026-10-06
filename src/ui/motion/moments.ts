import type { HapticKind, MotionLevel, SoundName } from './tokens';

/**
 * Money Moments: the things that happen to a person's money that deserve a
 * response. Screens and stores say what happened; this table says how the app
 * answers. No screen decides its own celebration.
 */

export type MomentType =
  | 'SALARY_RECEIVED'
  | 'INCOME_RECEIVED'
  | 'EXPENSE_RECORDED'
  | 'INVESTED'
  | 'SAVING_ADDED'
  | 'GOAL_25'
  | 'GOAL_50'
  | 'GOAL_75'
  | 'GOAL_COMPLETE'
  | 'BUDGET_COMPLETED'
  | 'TRANSACTION_REVIEWED'
  | 'BACKUP_COMPLETED'
  | 'NET_WORTH_MILESTONE';

export type Moment = {
  type: MomentType;
  /** Unique per real event; the same event is never answered twice. */
  key: string;
  /** When it was noticed (ms since epoch). */
  at: number;
  /** Whole paise, positive; the size of the event. */
  amount?: number;
  /** A category, goal or budget name. */
  label?: string;
  /** Which goal or budget, for finding it on screen. */
  ref?: string;
  /** For a goal: what it had and has now, in paise. */
  from?: number;
  to?: number;
};

/** How the app shows it. */
export type EffectKind =
  | 'salary'
  | 'inflow'
  | 'outflow'
  | 'invest'
  | 'save'
  | 'milestone'
  | 'review'
  | 'backup'
  | 'budget'
  | 'complete'
  | 'networth';

export type Rule = {
  level: MotionLevel;
  effect: EffectKind;
  /** One haptic, or two played one after the other. */
  haptic?: HapticKind | readonly [HapticKind, HapticKind];
  sound?: SoundName;
  /** The same sound is not repeated within this many ms. */
  soundGapMs?: number;
  /** After this long an event is history and shows nothing. */
  freshMs: number;
};

const SECONDS = 1000;
const HOURS = 3_600_000;
const MINUTES = 60_000;

/**
 * Roughly: 80% calm (motion only), 15% micro delight (a haptic), 4% a
 * meaningful celebration (a sound as well), 1% a cinematic.
 */
export const RULES: Record<MomentType, Rule> = {
  // The one signature moment.
  SALARY_RECEIVED: { level: 'cinematic', effect: 'salary', haptic: ['medium', 'success'], sound: 'moneyIn', freshMs: 12 * HOURS },
  INCOME_RECEIVED: { level: 'meaningful', effect: 'inflow', haptic: 'light', sound: 'moneyIn', soundGapMs: 10 * MINUTES, freshMs: 20 * SECONDS },
  EXPENSE_RECORDED: { level: 'meaningful', effect: 'outflow', haptic: 'light', sound: 'moneyOut', soundGapMs: 15 * MINUTES, freshMs: 20 * SECONDS },
  INVESTED: { level: 'meaningful', effect: 'invest', haptic: 'light', freshMs: 20 * SECONDS },
  SAVING_ADDED: { level: 'meaningful', effect: 'save', haptic: 'medium', sound: 'save', soundGapMs: 20 * SECONDS, freshMs: 20 * SECONDS },
  GOAL_25: { level: 'meaningful', effect: 'milestone', haptic: 'success', sound: 'save', freshMs: 20 * SECONDS },
  GOAL_50: { level: 'meaningful', effect: 'milestone', haptic: 'success', sound: 'save', freshMs: 20 * SECONDS },
  GOAL_75: { level: 'meaningful', effect: 'milestone', haptic: 'success', sound: 'save', freshMs: 20 * SECONDS },
  GOAL_COMPLETE: { level: 'cinematic', effect: 'complete', haptic: 'milestone', sound: 'milestone', freshMs: 20 * SECONDS },
  BUDGET_COMPLETED: { level: 'meaningful', effect: 'budget', haptic: 'success', sound: 'success', freshMs: 30 * SECONDS },
  TRANSACTION_REVIEWED: { level: 'meaningful', effect: 'review', haptic: 'light', sound: 'success', soundGapMs: 1500, freshMs: 20 * SECONDS },
  BACKUP_COMPLETED: { level: 'meaningful', effect: 'backup', haptic: 'success', sound: 'save', freshMs: 20 * SECONDS },
  NET_WORTH_MILESTONE: { level: 'cinematic', effect: 'networth', haptic: 'milestone', sound: 'milestone', freshMs: 12 * HOURS },
};

/** True while an event is recent enough to answer. */
export const isFresh = (moment: Moment, now: number): boolean => now - moment.at <= RULES[moment.type].freshMs;

// ------------------------------------------------------------------------- bus

type Listener = (moment: Moment) => void;

const listeners = new Set<Listener>();
/** Events that arrive before anyone listens (the app is still starting) wait here. */
let waiting: Moment[] = [];
const seen = new Set<string>();

/** Tells the app something happened. The same `key` is answered once. */
export const emitMoment = (moment: Moment): void => {
  if (seen.has(moment.key)) return;
  seen.add(moment.key);
  if (seen.size > 200) seen.delete(seen.values().next().value as string);
  if (listeners.size === 0) {
    waiting = [...waiting, moment].slice(-8);
    return;
  }
  for (const listener of listeners) listener(moment);
};

export const onMoment = (listener: Listener): (() => void) => {
  listeners.add(listener);
  const backlog = waiting;
  waiting = [];
  for (const moment of backlog) listener(moment);
  return () => {
    listeners.delete(listener);
  };
};

/** Test helper: forgets everything the bus has seen. */
export const resetMoments = (): void => {
  listeners.clear();
  waiting = [];
  seen.clear();
};

// ---------------------------------------------------------------------- screen

/** Which screen is in front, so an event waits for the screen it belongs on. */
let screen = 'Loading';
const screenListeners = new Set<(screen: string) => void>();

export const setScreen = (next: string): void => {
  if (next === screen) return;
  screen = next;
  for (const listener of screenListeners) listener(next);
};

export const getScreen = (): string => screen;

export const onScreen = (listener: (screen: string) => void): (() => void) => {
  screenListeners.add(listener);
  return () => {
    screenListeners.delete(listener);
  };
};
