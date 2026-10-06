/**
 * Safe to spend as a charge, and the mood of the screen around it.
 *
 * Both are pictures of figures the app already has. The charge is the share
 * of what sits in the accounts that is free until payday: a fact from the
 * safe-to-spend lines, not a target or a score.
 */

export type ChargeState = 'green' | 'amber' | 'red';

export type Charge = {
  /** 0 to 1: how much of the account balance is free. */
  fraction: number;
  state: ChargeState;
};

/** Free above this share of the balance reads green; below the second, red. */
const AMBER_BELOW = 0.35;
const RED_BELOW = 0.12;

/** `free` is the safe-to-spend figure (can be negative); `liquid` what the accounts hold. */
export const chargeOf = (free: number, liquid: number): Charge => {
  if (free <= 0 || liquid <= 0) return { fraction: 0, state: 'red' };
  const fraction = Math.min(1, free / liquid);
  return { fraction, state: fraction < RED_BELOW ? 'red' : fraction < AMBER_BELOW ? 'amber' : 'green' };
};

/** What the screen says about it, in words that describe and never advise. */
export const chargeNote = (state: ChargeState): string =>
  state === 'green'
    ? 'Plenty of room.'
    : state === 'amber'
      ? 'Room is being used up.'
      : 'Your remaining spending room is getting tighter.';

// --------------------------------------------------------------------- weather

export type Weather = 'healthy' | 'normal' | 'commitments' | 'pressure';

export type WeatherInput = {
  /** Undefined until a payday is set: with no picture, no weather. */
  charge?: Charge;
  /** The safe-to-spend figure; a negative one is pressure whatever the charge. */
  free?: number;
  /** Recurring payments due in the next week, in paise. */
  dueSoon: number;
  /** Budgets already over their limit. */
  overBudgets: number;
};

/**
 * A faint mood for the background. Kept to four states so it is felt, not read:
 * heavy commitments (a lot due soon against what is free), pressure (little or
 * nothing free, or budgets over), healthy (plenty free, nothing over), normal.
 */
export const weatherOf = ({ charge, free, dueSoon, overBudgets }: WeatherInput): Weather => {
  if (!charge || free === undefined) return 'normal';
  if (free <= 0 || charge.state === 'red') return 'pressure';
  if (dueSoon > 0 && dueSoon >= free * 0.5) return 'commitments';
  if (overBudgets > 0 || charge.state === 'amber') return 'normal';
  return 'healthy';
};
