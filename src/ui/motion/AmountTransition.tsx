import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type TextStyle } from 'react-native';
import { paise, type Paise } from '@/money/money';
import { useLedger } from '../store';
import { useAmount, useInk } from '../kit';
import { allows } from './policy';
import { useMotionPrefs } from './useMotion';
import { countAt, countDuration, direction } from './numbers';
import { onPlan, peekCount, startOf, takeCount } from './counting';
import { DURATION } from './tokens';

/**
 * A figure that moves to its new value instead of snapping. Whole paise all
 * the way, an ease-out curve, quicker for a small change and a little longer
 * for a big one. Nothing runs when the amounts are hidden (the text is a mask),
 * or when the user has asked for no motion.
 */
export const useCounted = (
  value: number,
  options: { enabled?: boolean; slot?: string } = {}
): { shown: number; dir: 1 | -1 | 0; runs: number; settle: Animated.Value } => {
  const { enabled = true, slot } = options;
  const hidden = useLedger((s) => s.hideAmounts);
  const prefs = useMotionPrefs();
  const canCount = enabled && !hidden && allows(prefs.motion, 'amount');

  // A planned count starts from its own value, so the first paint is the old figure, not a flash of the new.
  const [shown, setShown] = useState(() => {
    const plan = enabled ? peekCount(slot) : undefined;
    return plan ? startOf(plan, value) : value;
  });
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const [runs, setRuns] = useState(0);
  const settle = useRef(new Animated.Value(1)).current;
  const shownRef = useRef(shown);
  const first = useRef(true);
  const [planTick, setPlanTick] = useState(0);

  // A plan set while the figure is already showing (the salary arrival) is taken up at once.
  useEffect(() => (enabled && slot ? onPlan(slot, () => setPlanTick((n) => n + 1)) : undefined), [enabled, slot]);

  useEffect(() => {
    if (!enabled) return;
    const isFirst = first.current;
    first.current = false;
    const plan = enabled ? takeCount(slot) : undefined;
    const from = plan ? startOf(plan, value) : isFirst ? value : shownRef.current;

    if (!canCount || from === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }

    const duration = plan?.durationMs ?? countDuration(from, value);
    const delay = plan?.delayMs ?? 0;
    let frame: ReturnType<typeof requestAnimationFrame> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    shownRef.current = from;
    setShown(from);

    const run = () => {
      const started = Date.now();
      setDir(direction(from, value));
      setRuns((n) => n + 1);
      settle.setValue(0);
      Animated.timing(settle, {
        toValue: 1,
        duration: DURATION.micro.card + 100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      const step = () => {
        const progress = (Date.now() - started) / duration;
        const next = countAt(from, value, progress);
        shownRef.current = next;
        setShown(next);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      step();
    };

    if (delay > 0) timer = setTimeout(run, delay);
    else run();

    return () => {
      if (timer) clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      // A change that interrupts a count carries on from where it had got to.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, canCount, planTick]);

  // Not counting: the figure is the value itself, this very render, never one frame behind.
  return { shown: enabled && canCount ? shown : value, dir, runs, settle };
};

/**
 * A large figure (wealth, safe to spend): it settles into place as it changes,
 * brightening a little, with a small arrow that says which way it went and
 * then fades. `slot` lets a planned count (the salary arrival) drive it.
 */
export const AmountTransition: React.FC<{
  value: Paise;
  style: TextStyle;
  slot?: string;
  paise?: boolean;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}> = ({ value, style, slot, paise: withPaise, numberOfLines, adjustsFontSizeToFit, minimumFontScale }) => {
  const show = useAmount();
  const { colors } = useInk();
  const { shown, dir, runs, settle } = useCounted(value, { slot });
  const arrow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (runs === 0) return;
    arrow.setValue(1);
    Animated.timing(arrow, { toValue: 0, duration: 1200, delay: 700, useNativeDriver: true }).start();
  }, [runs, arrow]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.Text
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
        minimumFontScale={minimumFontScale}
        style={[
          style,
          { flexShrink: 1 },
          {
            opacity: settle.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
            transform: [{ translateY: settle.interpolate({ inputRange: [0, 1], outputRange: [dir < 0 ? -6 : 6, 0] }) }],
          },
        ]}
      >
        {show(paise(shown), { paise: withPaise })}
      </Animated.Text>
      {dir !== 0 && (
        <Animated.Text
          style={{
            marginLeft: 8,
            fontSize: 14,
            color: dir > 0 ? colors.positive : colors.negative,
            opacity: arrow,
          }}
        >
          {dir > 0 ? '▲' : '▼'}
        </Animated.Text>
      )}
    </View>
  );
};
