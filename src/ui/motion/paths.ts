import { PARTICLES } from './tokens';

/**
 * The geometry of moving money: where particles start, the curve they take,
 * how many there are. Pure, and seeded, so an effect looks the same for the
 * same event and can be tested.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** A small deterministic random number generator (mulberry32). */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Same text, same number. */
export const seedOf = (text: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
};

export const centerOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** 8 to 20 particles, more on a wider screen. */
export const particleCount = (screenWidth: number, scale = 1): number =>
  Math.max(PARTICLES.min, Math.min(PARTICLES.max, Math.round((screenWidth / 26) * scale)));

/** Points on a wobbly ring around a centre, evenly spread by angle. */
export const ringPoints = (rand: () => number, center: Point, count: number, near: number, far: number): Point[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = ((i + rand() * 0.6) / count) * Math.PI * 2;
    const radius = near + rand() * (far - near);
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });

/** Points just inside the edges of the screen, spread around it. */
export const edgePoints = (rand: () => number, width: number, height: number, count: number, inset = 12): Point[] =>
  Array.from({ length: count }, (_, i) => {
    const side = i % 4;
    const along = rand();
    if (side === 0) return { x: along * width, y: inset };
    if (side === 1) return { x: width - inset, y: along * height };
    if (side === 2) return { x: along * width, y: height - inset };
    return { x: inset, y: along * height };
  });

/**
 * A curved path from `from` to `to`: a quadratic curve whose middle is pushed
 * sideways by `bend` times the distance. Returns `steps + 1` points.
 */
export const curve = (from: Point, to: Point, bend = 0.25, steps = 12): Point[] => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const control = { x: (from.x + to.x) / 2 - dy * bend, y: (from.y + to.y) / 2 + dx * bend };
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
  });
};

/** Evenly spaced 0..1 values, the input side of an interpolation. */
export const unit = (steps: number): number[] => Array.from({ length: steps + 1 }, (_, i) => i / steps);

/** Keeps a point on screen, for a destination that has scrolled out of view. */
export const clampToScreen = (point: Point, width: number, height: number, margin = 24): Point => ({
  x: Math.max(margin, Math.min(width - margin, point.x)),
  y: Math.max(margin, Math.min(height - margin, point.y)),
});
