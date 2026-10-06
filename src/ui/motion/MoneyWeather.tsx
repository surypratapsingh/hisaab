import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, View, useWindowDimensions } from 'react-native';
import { useInk } from '../kit';
import type { Weather } from './battery';
import { useMotion } from './useMotion';

/**
 * A faint atmosphere at the top of Home that follows the state of the money:
 * a warm, clear glow when there is plenty of room, an amber cast when much is
 * due soon, a slightly darker red one under pressure, and nothing at all
 * otherwise. It is meant to be felt more than seen (a few percent at most),
 * it is drawn once from plain discs (no blur, no loop), and it changes over
 * a second and a half so it never announces itself.
 */

const LAYERS = 9;

// Development preview only: the motion preview can pin a mood to look at it. Null in normal use.
let pinned: Weather | null = null;
const watchers = new Set<() => void>();
export const previewWeather = (weather: Weather | null): void => {
  pinned = weather;
  for (const watcher of watchers) watcher();
};
const watchPinned = (watcher: () => void) => {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
};

/** Warm gold for a healthy month, amber and red drawn from the theme. */
const TINT = (weather: Weather, colors: { warning: string; negative: string }, dark: boolean): { color: string; alpha: number } | null => {
  if (weather === 'healthy') return { color: dark ? '#FDE68A' : '#F2C94C', alpha: dark ? 0.085 : 0.16 };
  if (weather === 'commitments') return { color: colors.warning, alpha: dark ? 0.09 : 0.13 };
  if (weather === 'pressure') return { color: colors.negative, alpha: dark ? 0.09 : 0.1 };
  return null;
};

const Sky: React.FC<{ tint: { color: string; alpha: number }; opacity: Animated.Value | Animated.AnimatedInterpolation<number> }> = ({ tint, opacity }) => {
  const { width } = useWindowDimensions();
  const size = width * 1.6;
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: -size * 0.55, left: (width - size) / 2, width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }}
    >
      {Array.from({ length: LAYERS }, (_, i) => {
        const d = (size * (i + 1)) / LAYERS;
        return (
          <View
            key={i}
            style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: tint.color, opacity: tint.alpha / (LAYERS * 0.55) }}
          />
        );
      })}
    </Animated.View>
  );
};

export const MoneyWeather: React.FC<{ weather: Weather }> = ({ weather: real }) => {
  const { colors, dark } = useInk();
  const weather = useSyncExternalStore(watchPinned, () => pinned) ?? real;
  const { can } = useMotion();
  const [shown, setShown] = useState<{ now: Weather; before: Weather | null }>({ now: weather, before: null });
  const arrive = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (weather === shown.now) return;
    setShown({ now: weather, before: shown.now });
    arrive.setValue(can('fade') ? 0 : 1);
    Animated.timing(arrive, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start(() =>
      setShown((s) => ({ now: s.now, before: null }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather]);

  const now = TINT(shown.now, colors, dark);
  const before = shown.before ? TINT(shown.before, colors, dark) : null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 0 }}>
      {before && <Sky tint={before} opacity={arrive.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })} />}
      {now && <Sky tint={now} opacity={arrive} />}
    </View>
  );
};
