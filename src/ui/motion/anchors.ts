import { useCallback } from 'react';
import type { View } from 'react-native';
import type { Rect } from './paths';

/**
 * Where things are on screen, so money can travel from one to another. A view
 * marks itself with `useAnchor('hero')`; the motion layer measures it only
 * when an effect needs it. Nothing is tracked while nothing is animating.
 */

const nodes = new Map<string, View>();

/** Put the returned function on a View's `ref` (and `collapsable={false}`). */
export const useAnchor = (key: string | undefined): ((node: View | null) => void) =>
  useCallback(
    (node: View | null) => {
      if (!key) return;
      if (node) nodes.set(key, node);
      else nodes.delete(key);
    },
    [key]
  );

/** The place an anchor holds in the window, or null if it is not on screen right now. */
export const measureAnchor = (key: string): Promise<Rect | null> =>
  new Promise((resolve) => {
    const node = nodes.get(key);
    if (!node) return resolve(null);
    try {
      node.measureInWindow((x, y, width, height) => {
        resolve(width > 0 || height > 0 ? { x, y, width, height } : null);
      });
    } catch {
      resolve(null);
    }
  });

/** The first of several anchors that is on screen (and, if asked, passes `accept`). */
export const measureFirst = async (keys: string[], accept?: (rect: Rect) => boolean): Promise<Rect | null> => {
  for (const key of keys) {
    const found = await measureAnchor(key);
    if (found && (!accept || accept(found))) return found;
  }
  return null;
};
