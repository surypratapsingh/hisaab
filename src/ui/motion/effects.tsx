import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Text, View, type ViewStyle } from 'react-native';
import type { Colors } from '../palette';
import { Icon } from '../kit';
import { DURATION } from './tokens';
import { centerOf, curve, edgePoints, particleCount, ringPoints, seeded, type Point, type Rect } from './paths';
import { Particle, along, life, pulse, track } from './Particle';
import { easeInOut } from './numbers';

/**
 * The visible half of the money motion language. Each effect is one short
 * piece of choreography on a single 0..1 clock; the host mounts it, it plays
 * once, and it removes itself. Nothing loops and nothing lingers: when an
 * effect has finished there are no particles left anywhere.
 */

type Base = { seed: number; colors: Colors; onDone: () => void };

/** One linear clock; calls `onDone` when it reaches 1. */
const useClock = (duration: number, onDone: () => void): Animated.Value => {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(p, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true });
    run.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return p;
};

const at = (point: Point, extra: ViewStyle = {}): ViewStyle => ({
  position: 'absolute',
  left: point.x,
  top: point.y,
  ...extra,
});

const GLOW_LAYERS = 10;

/**
 * A soft glow: ten discs, each a little wider than the last and each faint,
 * so the edge fades over many steps instead of ending in a visible line. No
 * blur is used (a blur is costly); the whole glow fades and swells on the
 * native driver.
 */
const Glow: React.FC<{ center: Point; size: number; color: string; opacity: Animated.AnimatedInterpolation<number>; scale: Animated.AnimatedInterpolation<number> }> = ({
  center,
  size,
  color,
  opacity,
  scale,
}) => (
  <Animated.View
    pointerEvents="none"
    style={{
      position: 'absolute',
      left: center.x - size / 2,
      top: center.y - size / 2,
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      opacity,
      transform: [{ scale }],
    }}
  >
    {Array.from({ length: GLOW_LAYERS }, (_, i) => {
      const d = (size * (i + 1)) / GLOW_LAYERS;
      return (
        <View
          key={i}
          style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: color, opacity: 0.1 }}
        />
      );
    })}
  </Animated.View>
);

/** An outline that grows and fades: something arrived here. */
const Ring: React.FC<{ center: Point; size: number; color: string; p: Animated.Value; start: number; end: number; peak?: number }> = ({
  center,
  size,
  color,
  p,
  start,
  end,
  peak = 0.5,
}) => (
  <Animated.View
    pointerEvents="none"
    style={{
      position: 'absolute',
      left: center.x - size / 2,
      top: center.y - size / 2,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 2,
      borderColor: color,
      opacity: pulse(p, start, start + (end - start) * 0.25, end, peak),
      transform: [{ scale: track(p, 0.5, 2.1, start, end) }],
    }}
  />
);

// ------------------------------------------------------------------- money in

/** Money entering: particles gather from around the target and settle into it. */
export const InflowFx: React.FC<Base & { target: Point; count: number }> = ({ target, count, seed, colors, onDone }) => {
  const p = useClock(DURATION.meaningful.moneyIn, onDone);
  const items = useMemo(() => {
    const rand = seeded(seed);
    return ringPoints(rand, target, Math.min(count, 12), 60, 130).map((from) => {
      const start = rand() * 0.22;
      return { from, start, end: start + 0.55, size: 4 + Math.round(rand() * 2) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Glow
        center={target}
        size={72}
        color={colors.positive}
        opacity={p.interpolate({ inputRange: [0, 0.45, 0.65, 1], outputRange: [0, 0, 0.2, 0], extrapolate: 'clamp' })}
        scale={p.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.7, 0.8, 1.5], extrapolate: 'clamp' })}
      />
      {items.map((item, i) => {
        const move = along(p, [item.from, target], item.start, item.end);
        return (
          <Particle
            key={i}
            color={colors.positive}
            size={item.size}
            style={{
              opacity: life(p, item.start, item.end),
              transform: [{ translateX: move.x }, { translateY: move.y }, { scale: track(p, 1, 0.45, item.start, item.end) }],
            }}
          />
        );
      })}
    </>
  );
};

// ------------------------------------------------------------------ money out

/** Money leaving: one particle (and two behind it) travels from where it was to where it went. */
export const OutflowFx: React.FC<Base & { from: Point; to: Point; label: string }> = ({ from, to, label, colors, onDone }) => {
  const p = useClock(1000, onDone);
  const path = useMemo(() => curve(from, to, 0.2), [from, to]);
  const trail = [
    { delay: 0, size: 7, alpha: 0.95 },
    { delay: 0.07, size: 5, alpha: 0.55 },
    { delay: 0.14, size: 4, alpha: 0.32 },
  ];
  const arrive = 0.66;

  return (
    <>
      {trail.map((dot, i) => {
        const move = along(p, path, dot.delay, arrive + dot.delay * 0.4, easeInOut);
        return (
          <Particle
            key={i}
            color={colors.textPrimary}
            size={dot.size}
            style={{
              opacity: p.interpolate({
                inputRange: [0, dot.delay, dot.delay + 0.05, arrive + dot.delay * 0.4 - 0.05, arrive + dot.delay * 0.4 + 0.02, 1],
                outputRange: [0, 0, dot.alpha, dot.alpha, 0, 0],
                extrapolate: 'clamp',
              }),
              transform: [{ translateX: move.x }, { translateY: move.y }],
            }}
          />
        );
      })}
      <Ring center={to} size={44} color={colors.textPrimary} p={p} start={arrive - 0.04} end={1} peak={0.35} />
      <Animated.View
        pointerEvents="none"
        style={[
          at({ x: to.x - 150, y: to.y - 52 }, { width: 300, alignItems: 'center' }),
          {
            opacity: p.interpolate({ inputRange: [0, arrive - 0.02, arrive + 0.08, 0.92, 1], outputRange: [0, 0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [{ translateY: track(p, 6, 0, arrive - 0.02, arrive + 0.12) }],
          },
        ]}
      >
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 14,
            backgroundColor: colors.surfaceElevated,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>{label}</Text>
        </View>
      </Animated.View>
    </>
  );
};

// ---------------------------------------------------------------- money saved

/** Money saved: particles converge on the goal, it compresses, and a lock settles. */
export const SaveFx: React.FC<Base & { target: Rect }> = ({ target, seed, colors, onDone }) => {
  const p = useClock(DURATION.meaningful.save, onDone);
  const center = centerOf(target);
  const items = useMemo(() => {
    const rand = seeded(seed);
    return ringPoints(rand, center, 9, 90, 170).map((from) => {
      const start = rand() * 0.25;
      return { from, start, end: start + 0.4 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {items.map((item, i) => {
        const move = along(p, [item.from, center], item.start, item.end);
        return (
          <Particle
            key={i}
            color={colors.accent}
            size={5}
            style={{
              opacity: life(p, item.start, item.end),
              transform: [{ translateX: move.x }, { translateY: move.y }, { scale: track(p, 1, 0.4, item.start, item.end) }],
            }}
          />
        );
      })}
      {/* The card takes the weight: a hairline outline that presses in, then eases out. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: target.x,
          top: target.y,
          width: target.width,
          height: target.height,
          borderRadius: 24,
          borderWidth: 2,
          borderColor: colors.accent,
          opacity: pulse(p, 0.5, 0.62, 1, 0.7),
          transform: [{ scale: p.interpolate({ inputRange: [0, 0.5, 0.65, 0.85, 1], outputRange: [1, 1, 0.985, 1.008, 1] }) }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          at({ x: target.x + target.width - 44, y: target.y + 14 }),
          {
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
            opacity: p.interpolate({ inputRange: [0, 0.6, 0.68, 0.9, 1], outputRange: [0, 0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [{ scale: p.interpolate({ inputRange: [0, 0.6, 0.74, 0.84, 1], outputRange: [0.4, 0.4, 1.25, 1, 1], extrapolate: 'clamp' }) }],
          },
        ]}
      >
        <Icon name="lock" size={16} color={colors.onAccent} />
      </Animated.View>
    </>
  );
};

// --------------------------------------------------------------- money invested

/** Money invested: it travels to the investments, then circles them once before it is gone. */
export const InvestFx: React.FC<Base & { from: Point; target: Point }> = ({ from, target, colors, onDone }) => {
  const p = useClock(950, onDone);
  const path = useMemo(() => curve(from, target, 0.18), [from, target]);
  const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

  return (
    <>
      {angles.map((_angle, i) => {
        const delay = i * 0.05;
        const move = along(p, path, delay, 0.42 + delay);
        return (
          <Particle
            key={`travel-${i}`}
            color={colors.accent}
            size={5}
            style={{
              opacity: p.interpolate({ inputRange: [0, delay, delay + 0.05, 0.4 + delay, 0.46 + delay, 1], outputRange: [0, 0, 0.9, 0.9, 0, 0], extrapolate: 'clamp' }),
              transform: [{ translateX: move.x }, { translateY: move.y }],
            }}
          />
        );
      })}
      <Animated.View
        pointerEvents="none"
        style={[
          at(target),
          {
            width: 0,
            height: 0,
            opacity: p.interpolate({ inputRange: [0, 0.4, 0.48, 0.86, 1], outputRange: [0, 0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [{ rotate: p.interpolate({ inputRange: [0.4, 1], outputRange: ['0deg', '400deg'], extrapolate: 'clamp' }) }],
          },
        ]}
      >
        {angles.map((angle, i) => (
          <Particle
            key={`orbit-${i}`}
            color={colors.accent}
            size={5}
            style={{ transform: [{ translateX: Math.cos(angle) * 26 }, { translateY: Math.sin(angle) * 26 }] }}
          />
        ))}
      </Animated.View>
    </>
  );
};

// ------------------------------------------------------------------ small ring

/** A ring, a pulse, and a few tiny particles drifting out: a goal quarter, a budget kept, a category settled. */
export const BurstFx: React.FC<Base & { center: Point; count?: number; tone?: 'accent' | 'positive'; duration?: number }> = ({
  center,
  count = 8,
  tone = 'positive',
  duration = DURATION.meaningful.ring,
  seed,
  colors,
  onDone,
}) => {
  const p = useClock(duration, onDone);
  const color = tone === 'accent' ? colors.accent : colors.positive;
  const items = useMemo(() => {
    const rand = seeded(seed);
    return Array.from({ length: count }, (_, i) => {
      const angle = ((i + rand() * 0.5) / Math.max(1, count)) * Math.PI * 2;
      const reach = 30 + rand() * 24;
      return { to: { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach }, size: 3 + Math.round(rand() * 2) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Glow
        center={center}
        size={60}
        color={color}
        opacity={pulse(p, 0, 0.25, 0.8, 0.2)}
        scale={track(p, 0.6, 1.4, 0, 0.8)}
      />
      <Ring center={center} size={40} color={color} p={p} start={0} end={1} peak={0.55} />
      {items.map((item, i) => {
        const move = along(p, [center, item.to], 0.05, 0.85);
        return (
          <Particle
            key={i}
            color={color}
            size={item.size}
            style={{ opacity: life(p, 0.05, 0.85, 0.85), transform: [{ translateX: move.x }, { translateY: move.y }] }}
          />
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------------- salary

/**
 * Salary arriving, the signature moment. A glow wakes behind the hero, a
 * handful of particles come in from the edges and gather on the figure, the
 * figure counts up (the hero does that itself, on a plan the host set), and
 * a quiet line says what happened. About 1.9 seconds, then nothing.
 */
export const SalaryFx: React.FC<
  Base & { hero: Rect; width: number; height: number; headline: string; detail: string }
> = ({ hero, width, height, headline, detail, seed, colors, onDone }) => {
  const p = useClock(DURATION.cinematic.salary, onDone);
  const center = centerOf(hero);
  const items = useMemo(() => {
    const rand = seeded(seed);
    return edgePoints(rand, width, height, particleCount(width)).map((from) => {
      const start = 0.04 + rand() * 0.24;
      return { from, start, end: start + 0.36, size: 4 + Math.round(rand() * 2) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glow = (size: number, peak: number) => (
    <Glow
      center={center}
      size={size}
      color={colors.positive}
      opacity={p.interpolate({ inputRange: [0, 0.12, 0.42, 0.8, 1], outputRange: [0, peak * 0.4, peak, peak * 0.5, 0], extrapolate: 'clamp' })}
      scale={p.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.85, 1, 1.12] })}
    />
  );

  return (
    <>
      {glow(340, 0.4)}
      {glow(180, 0.35)}
      {items.map((item, i) => {
        const move = along(p, [item.from, center], item.start, item.end);
        return (
          <Particle
            key={i}
            color={colors.positive}
            size={item.size}
            style={{
              opacity: life(p, item.start, item.end),
              transform: [{ translateX: move.x }, { translateY: move.y }, { scale: track(p, 1.1, 0.4, item.start, item.end) }],
            }}
          />
        );
      })}
      <Ring center={center} size={90} color={colors.positive} p={p} start={0.46} end={0.9} peak={0.4} />
      <Animated.View
        pointerEvents="none"
        style={[
          at({ x: 0, y: hero.y - 44 }, { width, alignItems: 'center' }),
          {
            opacity: p.interpolate({ inputRange: [0, 0.5, 0.62, 0.86, 1], outputRange: [0, 0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [{ translateY: track(p, 8, 0, 0.5, 0.66) }],
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1.4, color: colors.positive, textTransform: 'uppercase' }}>{headline}</Text>
          {detail ? <Text style={{ marginLeft: 8, fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>+{detail}</Text> : null}
        </View>
      </Animated.View>
    </>
  );
};

// -------------------------------------------------------- goal / net worth done

/** A finished goal or a net-worth line: a soft ring expands behind a short card, then the screen returns. */
export const CompleteFx: React.FC<Base & { width: number; height: number; kicker: string; title: string; detail: string }> = ({
  width,
  height,
  kicker,
  title,
  detail,
  colors,
  onDone,
}) => {
  const p = useClock(DURATION.cinematic.goalComplete, onDone);
  const center = { x: width / 2, y: height * 0.42 };
  const star = (dx: number, delay: number) => (
    <Animated.Text
      style={{
        position: 'absolute',
        left: center.x + dx - 8,
        top: center.y - 84,
        fontSize: 16,
        color: colors.accent,
        opacity: pulse(p, 0.12 + delay, 0.28 + delay, 0.6 + delay, 0.9),
        transform: [{ scale: track(p, 0.4, 1, 0.12 + delay, 0.32 + delay) }],
      }}
    >
      ✦
    </Animated.Text>
  );

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          backgroundColor: '#000',
          opacity: p.interpolate({ inputRange: [0, 0.18, 0.78, 1], outputRange: [0, 0.28, 0.28, 0], extrapolate: 'clamp' }),
        }}
      />
      <Ring center={center} size={220} color={colors.accent} p={p} start={0.08} end={0.7} peak={0.45} />
      <Ring center={center} size={220} color={colors.accent} p={p} start={0.2} end={0.85} peak={0.25} />
      {star(-34, 0)}
      {star(0, 0.05)}
      {star(34, 0.1)}
      <Animated.View
        pointerEvents="none"
        style={[
          at({ x: 24, y: center.y - 44 }, { width: width - 48, alignItems: 'center' }),
          {
            opacity: p.interpolate({ inputRange: [0, 0.16, 0.26, 0.78, 0.92, 1], outputRange: [0, 0, 1, 1, 0, 0], extrapolate: 'clamp' }),
            transform: [{ translateY: track(p, 10, 0, 0.16, 0.34) }, { scale: track(p, 0.96, 1, 0.16, 0.36) }],
          },
        ]}
      >
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 2.4, color: colors.accent }}>{kicker}</Text>
        <Text style={{ marginTop: 10, fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center' }}>{title}</Text>
        <Text style={{ marginTop: 6, fontSize: 18, fontWeight: '600', color: 'rgba(255,255,255,0.86)' }}>{detail}</Text>
      </Animated.View>
    </>
  );
};

// ----------------------------------------------------------------------- backup

/** A backup made: a small lock closes, and "Encrypted" turns into "Backed up". */
export const BackupFx: React.FC<Base & { width: number; height: number }> = ({ width, height, colors, onDone }) => {
  const p = useClock(1500, onDone);
  const center = { x: width / 2, y: height - 150 };
  const body = 26;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        at({ x: width / 2 - 110, y: center.y - 40 }),
        {
          width: 220,
          paddingVertical: 14,
          alignItems: 'center',
          borderRadius: 22,
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: p.interpolate({ inputRange: [0, 0.1, 0.86, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
          transform: [{ translateY: track(p, 14, 0, 0, 0.14) }],
        },
      ]}
    >
      <View style={{ width: body + 4, height: body + 14, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 3,
            borderColor: colors.accent,
            borderBottomWidth: 0,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            transform: [{ translateY: track(p, -8, 2, 0.16, 0.5, easeInOut) }],
          }}
        />
        <View style={{ width: body, height: 20, borderRadius: 6, backgroundColor: colors.accent }} />
      </View>
      <View style={{ height: 22, marginTop: 8, alignSelf: 'stretch', alignItems: 'center' }}>
        <Animated.Text
          style={{
            position: 'absolute',
            fontSize: 13,
            fontWeight: '600',
            letterSpacing: 1,
            color: colors.textSecondary,
            opacity: p.interpolate({ inputRange: [0, 0.1, 0.4, 0.5, 1], outputRange: [0, 1, 1, 0, 0], extrapolate: 'clamp' }),
          }}
        >
          Encrypted
        </Animated.Text>
        <Animated.Text
          style={{
            position: 'absolute',
            fontSize: 14,
            fontWeight: '700',
            color: colors.accent,
            opacity: p.interpolate({ inputRange: [0, 0.46, 0.6, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' }),
          }}
        >
          ✓ Backed up
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

// ------------------------------------------------------------- reduced motion

/** For reduced motion: no travel, only a short line that fades in and out. */
export const NoteFx: React.FC<Base & { width: number; height: number; text: string }> = ({ width, height, text, colors, onDone }) => {
  const p = useClock(1600, onDone);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        at({ x: 24, y: height - 150 }, { width: width - 48, alignItems: 'center' }),
        { opacity: p.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }) },
      ]}
    >
      <View style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{text}</Text>
      </View>
    </Animated.View>
  );
};
