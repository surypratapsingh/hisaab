import React from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import { bezierEase, easeOut } from './numbers';
import type { Point } from './paths';

/**
 * The money particle: a small round dot with a soft halo. Abstract on purpose
 * (never a coin), and drawn from two plain views so it costs almost nothing.
 * Position it with an animated `translateX` / `translateY` in the overlay's
 * own coordinates; the dot is centred on that point.
 */
export const Particle: React.FC<{
  color: string;
  size?: number;
  style?: Animated.WithAnimatedValue<ViewStyle>;
}> = ({ color, size = 6, style }) => {
  const halo = size * 2.8;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: -halo / 2,
          top: -halo / 2,
          width: halo,
          height: halo,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View
        style={{ position: 'absolute', width: halo, height: halo, borderRadius: halo / 2, backgroundColor: color, opacity: 0.16 }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </Animated.View>
  );
};

// ------------------------------------------------------------------- tracking

/**
 * One clock (`p`, 0 to 1, linear) drives a whole effect. These turn it into
 * eased values for a stretch of that clock, sampled up front so the native
 * driver can run them with nothing on the JS thread.
 */

const STEPS = 10;

/** `p` maps to `from` before `start`, glides to `to` by `end`, holds after. */
export const track = (
  p: Animated.Value,
  from: number,
  to: number,
  start = 0,
  end = 1,
  ease: (t: number) => number = easeOut
): Animated.AnimatedInterpolation<number> => {
  const input = [0];
  const output = [from];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    input.push(start + (end - start) * t);
    output.push(from + (to - from) * ease(t));
  }
  if (end < 1) {
    input.push(1);
    output.push(to);
  }
  return p.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
};

/** A value that rises to `peak` and falls back to 0 between three moments on the clock. */
export const pulse = (
  p: Animated.Value,
  start: number,
  peakAt: number,
  end: number,
  peak = 1
): Animated.AnimatedInterpolation<number> =>
  p.interpolate({
    inputRange: [0, start, peakAt, end, 1],
    outputRange: [0, 0, peak, 0, 0],
    extrapolate: 'clamp',
  });

/** Opacity for a particle that appears at `start`, stays, and is gone by `end`. */
export const life = (p: Animated.Value, start: number, end: number, peak = 0.9): Animated.AnimatedInterpolation<number> => {
  const rise = Math.min(0.06, (end - start) / 4);
  return p.interpolate({
    inputRange: [0, start, start + rise, end - rise * 1.5, end, 1],
    outputRange: [0, 0, peak, peak, 0, 0],
    extrapolate: 'clamp',
  });
};

const at = (points: Point[], u: number): Point => {
  const last = points.length - 1;
  const scaled = Math.max(0, Math.min(1, u)) * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const f = scaled - i;
  return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
};

/** x and y along a curve, eased, between two moments on the clock. */
export const along = (
  p: Animated.Value,
  points: Point[],
  start = 0,
  end = 1,
  ease: (t: number) => number = easeOut
): { x: Animated.AnimatedInterpolation<number>; y: Animated.AnimatedInterpolation<number> } => {
  const input = [0];
  const xs = [points[0].x];
  const ys = [points[0].y];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const point = at(points, ease(t));
    input.push(start + (end - start) * t);
    xs.push(point.x);
    ys.push(point.y);
  }
  if (end < 1) {
    const finish = points[points.length - 1];
    input.push(1);
    xs.push(finish.x);
    ys.push(finish.y);
  }
  return {
    x: p.interpolate({ inputRange: input, outputRange: xs, extrapolate: 'clamp' }),
    y: p.interpolate({ inputRange: input, outputRange: ys, extrapolate: 'clamp' }),
  };
};

export const gentle = bezierEase([0.4, 0, 0.2, 1]);
