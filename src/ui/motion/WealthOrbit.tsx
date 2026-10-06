import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { WealthView } from '@/wealth/repo';
import { paise } from '@/money/money';
import { Amount } from '../parts';
import { useAmount, useInk } from '../kit';
import { orbitLayout, orbitNodes, NODE_MAX, type OrbitKind, type OrbitPlace } from './orbit';
import { SPRING } from './tokens';
import { useMotion } from './useMotion';

const NAMES: Record<OrbitKind, string> = { bank: 'Bank', cash: 'Cash', investment: 'Investments', other: 'Other' };

/** One body: it settles to its size and distance, breathes a little when it grows, and drifts on its arc. */
const Body: React.FC<{ place: OrbitPlace; drift: Animated.Value; phase: number; still: boolean }> = ({ place, drift, phase, still }) => {
  const { colors } = useInk();
  const show = useAmount();
  const radius = useRef(new Animated.Value(place.radius)).current;
  const scale = useRef(new Animated.Value(place.size / NODE_MAX)).current;
  const last = useRef(place);

  useEffect(() => {
    const before = last.current;
    last.current = place;
    if (still) {
      radius.setValue(place.radius);
      scale.setValue(place.size / NODE_MAX);
      return;
    }
    Animated.spring(radius, { toValue: place.radius, useNativeDriver: true, ...SPRING.snap }).start();
    // A body that grew swells past its new size and settles; one that shrank simply settles.
    const grew = place.size > before.size;
    Animated.spring(scale, { toValue: place.size / NODE_MAX, useNativeDriver: true, ...SPRING.snap }).start();
    if (grew) {
      scale.setValue((place.size / NODE_MAX) * 1.12);
      Animated.spring(scale, { toValue: place.size / NODE_MAX, useNativeDriver: true, ...SPRING.snap }).start();
    }
  }, [place.radius, place.size, still, radius, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const rad = (place.angle * Math.PI) / 180;
  const tone =
    place.kind === 'investment' ? colors.accent : place.kind === 'bank' ? colors.textPrimary : place.kind === 'cash' ? colors.warning : colors.textTertiary;
  const swing = still ? 0 : 5 * phase;
  const arc = drift.interpolate({ inputRange: [0, 1], outputRange: [`${-swing}deg`, `${swing}deg`] });
  const upright = drift.interpolate({ inputRange: [0, 1], outputRange: [`${swing}deg`, `${-swing}deg`] });

  return (
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: [{ rotate: arc }] }} pointerEvents="none">
      <Animated.View
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          transform: [
            { translateX: Animated.multiply(radius, Math.cos(rad)) },
            { translateY: Animated.multiply(radius, Math.sin(rad)) },
            { rotate: upright },
          ],
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            left: -NODE_MAX / 2,
            top: -NODE_MAX / 2,
            width: NODE_MAX,
            height: NODE_MAX,
            borderRadius: NODE_MAX / 2,
            backgroundColor: tone,
            opacity: 0.16,
            transform: [{ scale }],
          }}
        />
        <Animated.View
          style={{
            position: 'absolute',
            left: -NODE_MAX / 2,
            top: -NODE_MAX / 2,
            width: NODE_MAX,
            height: NODE_MAX,
            borderRadius: NODE_MAX / 2,
            borderWidth: 2,
            borderColor: tone,
            transform: [{ scale }],
          }}
        />
        <View style={{ position: 'absolute', left: -60, width: 120, top: place.size / 2 + 4, alignItems: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: colors.textSecondary }}>{NAMES[place.kind]}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textPrimary }}>{show(paise(place.value), { paise: false })}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
};

/**
 * Wealth as a small system: the total in the middle, its parts around it. A part
 * that grows swells and settles; the parts drift a few degrees on their arcs,
 * slowly, only while motion is Full. Every figure and size is the wealth view's
 * own (balances nobody has told the app are not drawn), and the picture adds
 * nothing the list below it does not say.
 */
export const WealthOrbit: React.FC<{ wealth: WealthView }> = ({ wealth }) => {
  const { can } = useMotion();
  const still = !can('orbit');
  const places = useMemo(
    () => orbitLayout(orbitNodes(wealth.parts.map((p) => ({ kind: p.kind, value: p.value, unknown: p.unknown || p.excluded })))),
    [wealth.parts]
  );
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still) {
      drift.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [still, drift]);

  // With one kind of holding there is nothing to compare; the plain figure says it all.
  if (places.length < 2) {
    return <Amount value={wealth.total} size="hero" fit animate />;
  }

  return (
    <View style={{ height: 300, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Wealth and where it sits">
      <View style={{ position: 'absolute', left: '50%', top: 150, width: 0, height: 0 }}>
        {places.map((place, i) => (
          <Body key={place.kind} place={place} drift={drift} phase={i % 2 === 0 ? 1 : -1} still={still} />
        ))}
      </View>
      <View style={{ width: 150, alignItems: "center" }}>
        <Amount value={wealth.total} size="figure" fit animate />
      </View>
    </View>
  );
};
