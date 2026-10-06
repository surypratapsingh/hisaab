import type { Rect } from './paths';

/**
 * Where the last thing pressed sat on screen, so the screen it opens can grow
 * out of it instead of cutting in. A card or row notes its place as the
 * finger goes down; the transition takes it once, if it is still fresh.
 */

const FRESH_MS = 1500;

let noted: { rect: Rect; at: number } | null = null;

export const noteOrigin = (rect: Rect, now = Date.now()): void => {
  noted = { rect, at: now };
};

/** The noted place, once. Null when there is none or it is too old to be the press that opened this. */
export const takeOrigin = (now = Date.now()): Rect | null => {
  const found = noted;
  noted = null;
  return found && now - found.at <= FRESH_MS ? found.rect : null;
};

export const clearOrigin = (): void => {
  noted = null;
};

/**
 * The transform that draws a full screen as small as `origin`, in the screen's
 * own coordinates (relative to its centre). Animating this to nothing looks
 * like the origin growing into the screen.
 */
export const shrunkTo = (
  origin: Rect,
  screen: Rect
): { translateX: number; translateY: number; scaleX: number; scaleY: number } => ({
  translateX: origin.x + origin.width / 2 - (screen.x + screen.width / 2),
  translateY: origin.y + origin.height / 2 - (screen.y + screen.height / 2),
  scaleX: Math.max(0.05, Math.min(1, origin.width / Math.max(1, screen.width))),
  scaleY: Math.max(0.03, Math.min(1, origin.height / Math.max(1, screen.height))),
});
