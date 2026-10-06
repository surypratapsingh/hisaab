import { DURATION, EASE } from './tokens';

/** Cubic-bezier easing in plain arithmetic, so it can be sampled anywhere. */
export const bezierEase = (curve: readonly [number, number, number, number]): ((t: number) => number) => {
  const [x1, y1, x2, y2] = curve;
  const axis = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (axis(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return axis(y1, y2, (lo + hi) / 2);
  };
};

export const easeOut = bezierEase(EASE.out);
export const easeInOut = bezierEase(EASE.inOut);

/**
 * The figure shown part of the way from `from` to `to`, always a whole
 * number of paise: a display never invents a fraction of a paisa.
 */
export const countAt = (from: number, to: number, progress: number): number => {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return Math.round(from + (to - from) * easeOut(progress));
};

/** A small change settles quickly, a big one takes a moment longer. */
export const countDuration = (from: number, to: number): number => {
  const rupees = Math.abs(to - from) / 100;
  const { amount, countUp } = { amount: DURATION.micro.amount, countUp: DURATION.meaningful.countUp };
  if (rupees < 1) return amount;
  const grown = amount + Math.log10(rupees + 1) * 90;
  return Math.round(Math.min(countUp, grown));
};

/** Which way a figure moved: 1 up, -1 down, 0 not at all. */
export const direction = (from: number, to: number): 1 | -1 | 0 => (to > from ? 1 : to < from ? -1 : 0);
