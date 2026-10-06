/**
 * The numbers behind Hisaab's motion, in one place. Money has a physical
 * language: it comes in, it goes out, it moves, it settles. Every duration,
 * curve and scale below belongs to one of three levels, so a screen never
 * invents its own.
 *
 * Nothing here imports React Native, so the rules can be tested in plain Node.
 */

export type MotionLevel = 'micro' | 'meaningful' | 'cinematic';

/** How long each level may take, in ms. */
export const LEVELS: Record<MotionLevel, { min: number; max: number }> = {
  /** Everyday touches: quiet and responsive. */
  micro: { min: 150, max: 350 },
  /** A financial event: satisfying, usually one haptic. */
  meaningful: { min: 400, max: 1000 },
  /** Rare. Salary, a finished goal, a big net-worth step. */
  cinematic: { min: 1000, max: 3000 },
};

export const DURATION = {
  micro: {
    press: 150,
    fade: 200,
    chip: 220,
    tab: 260,
    card: 300,
    amount: 340,
  },
  meaningful: {
    /** A confirmed row settling into a list. */
    settle: 480,
    review: 520,
    /** Old figure to new figure. */
    countUp: 650,
    moneyOut: 650,
    moneyIn: 700,
    ring: 700,
    save: 900,
    backup: 950,
  },
  cinematic: {
    salary: 1900,
    goalComplete: 2300,
    netWorth: 2300,
  },
} as const;

/** How long the money-flow picture takes to draw itself, in ms. An exploration, not a celebration, so outside the three levels. */
export const FLOW_MS = 1500;

/** Cubic-bezier control points, so a curve reads the same wherever it is used. */
export const EASE = {
  /** Fast start, long soft landing: things arriving and settling. */
  out: [0.16, 1, 0.3, 1],
  /** Symmetric: things that move from one place to another. */
  inOut: [0.65, 0, 0.35, 1],
  /** Slow start: things leaving. */
  in: [0.4, 0, 1, 1],
} as const;

/** Spring settings for the native driver (Animated.spring speed / bounciness). */
export const SPRING = {
  press: { speed: 40, bounciness: 4 },
  /** A chip or card snapping into place: a little overshoot, no wobble. */
  snap: { speed: 32, bounciness: 9 },
} as const;

export const SCALE = {
  press: 0.97,
  /** A tab icon arriving. */
  tab: 0.96,
  /** A chip that has just been chosen. */
  snap: 1.07,
  /** A destination acknowledging money. */
  pulse: 1.04,
  ring: 2.2,
} as const;

/** Particles per event scale with the screen, within these limits. */
export const PARTICLES = { min: 8, max: 20 } as const;

export type HapticKind = 'light' | 'medium' | 'success' | 'milestone' | 'warning';
export type SoundName = 'tap' | 'success' | 'moneyIn' | 'moneyOut' | 'save' | 'milestone' | 'error';
