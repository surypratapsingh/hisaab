import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { shrunkTo } from './origin';
import type { Rect } from './paths';
import { track } from './Particle';
import { DURATION } from './tokens';
import { canMove } from './useMotion';


/**
 * How a screen arrives. Opened from a card or a row, it grows out of that card
 * or row (the Safe to spend card becoming the Safe to spend screen, a
 * transaction becoming its detail). Otherwise it fades up a hair. With reduced
 * motion it only fades; with none it is simply there. It only ever plays when
 * the screen mounts, so it costs nothing afterwards.
 */
export const RouteTransition: React.FC<{ origin: Rect | null; children: React.ReactNode }> = ({ origin, children }) => {
  const ref = useRef<View>(null);
  const p = useRef(new Animated.Value(canMove('fade') ? 0 : 1)).current;
  const [from, setFrom] = useState<ReturnType<typeof shrunkTo> | null>(null);
  const grow = !!origin && canMove('travel');

  useEffect(() => {
    if (!canMove('fade')) return;
    const start = (frame: ReturnType<typeof shrunkTo> | null) => {
      setFrom(frame);
      Animated.timing(p, {
        toValue: 1,
        duration: frame ? DURATION.micro.amount - 20 : DURATION.micro.fade,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    };
    if (grow && origin && ref.current) {
      ref.current.measureInWindow((x, y, width, height) =>
        start(width > 0 && height > 0 ? shrunkTo(origin, { x, y, width, height }) : null)
      );
    } else {
      start(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transform = from
    ? [
        { translateX: track(p, from.translateX, 0, 0, 1) },
        { translateY: track(p, from.translateY, 0, 0, 1) },
        { scaleX: track(p, from.scaleX, 1, 0, 1) },
        { scaleY: track(p, from.scaleY, 1, 0, 1) },
      ]
    : [{ translateY: canMove('travel') ? track(p, 10, 0, 0, 1) : 0 }];

  return (
    <Animated.View
      ref={ref}
      collapsable={false}
      style={{
        flex: 1,
        opacity: p.interpolate({ inputRange: [0, from ? 0.3 : 0.8, 1], outputRange: [0, 1, 1] }),
        transform,
      }}
    >
      {children}
    </Animated.View>
  );
};
