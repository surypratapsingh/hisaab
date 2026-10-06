/**
 * A figure that is meant to start from somewhere other than what it last
 * showed, and to wait a moment first. The salary arrival uses it: the hero
 * total holds its old value while the particles gather, then counts up.
 */

export type CountPlan = {
  /** Count from this many paise back from the value that arrives (a salary of this size). */
  back: number;
  delayMs: number;
  durationMs?: number;
};

/** Where a plan starts, given the value the figure will end on. */
export const startOf = (plan: CountPlan, value: number): number => value - plan.back;

const plans = new Map<string, CountPlan & { expires: number }>();
const watchers = new Map<string, Set<() => void>>();

/** Calls back when a plan is set for `slot`, so a figure that is already on screen can take it up. */
export const onPlan = (slot: string, callback: () => void): (() => void) => {
  const set = watchers.get(slot) ?? new Set<() => void>();
  set.add(callback);
  watchers.set(slot, set);
  return () => {
    set.delete(callback);
  };
};

/** Asks the figure in `slot` to count once, as planned, the next time its value shows. */
export const scheduleCount = (slot: string, plan: CountPlan, now = Date.now(), lifeMs = 15_000): void => {
  plans.set(slot, { ...plan, expires: now + lifeMs });
  for (const callback of watchers.get(slot) ?? []) callback();
};

/** Looks at the plan without using it. */
export const peekCount = (slot: string | undefined, now = Date.now()): CountPlan | undefined => {
  if (!slot) return undefined;
  const plan = plans.get(slot);
  if (!plan) return undefined;
  if (plan.expires < now) {
    plans.delete(slot);
    return undefined;
  }
  return plan;
};

/** Uses the plan: it is not offered again. */
export const takeCount = (slot: string | undefined, now = Date.now()): CountPlan | undefined => {
  const plan = peekCount(slot, now);
  if (plan && slot) plans.delete(slot);
  return plan;
};

export const clearCounts = (): void => plans.clear();
