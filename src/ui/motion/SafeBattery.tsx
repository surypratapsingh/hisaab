import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useInk } from '../kit';
import { chargeNote, chargeOf, type ChargeState } from './battery';
import { EASE } from './tokens';
import { useMotion } from './useMotion';

const FILL = Easing.bezier(...EASE.out);

/**
 * How much of what is in the accounts is free until payday, drawn like a phone
 * battery. Charged and calm when there is plenty, warmer as it is used, low
 * and a little tense when it is nearly gone. It drains and refills smoothly
 * when the figure changes; it never flashes. The three moods each have their
 * own gentle motion (breathing, a slow pulse, a slight contraction), and none
 * of it runs unless motion is set to Full.
 */
export const SafeBattery: React.FC<{
  /** The safe-to-spend figure, in paise (can be negative). */
  free: number;
  /** What the accounts hold, in paise. */
  liquid: number;
  /** A shorter bar, for inside a card. */
  compact?: boolean;
}> = ({ free, liquid, compact }) => {
  const { colors } = useInk();
  const { can } = useMotion();
  const charge = chargeOf(free, liquid);
  const percent = Math.round(charge.fraction * 100);
  const width = compact ? 132 : 188;
  const height = compact ? 26 : 34;
  const inner = width - 8;

  // Fill: slides in from the left edge on the native driver.
  const level = useRef(new Animated.Value(charge.fraction)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      level.setValue(charge.fraction);
      return;
    }
    if (!can('fade')) {
      level.setValue(charge.fraction);
      return;
    }
    Animated.timing(level, { toValue: charge.fraction, duration: 900, easing: FILL, useNativeDriver: true }).start();
  }, [charge.fraction, level, can]);

  // Colour changes over a moment, not in a jump.
  const mood = useRef(new Animated.Value(MOOD[charge.state])).current;
  useEffect(() => {
    Animated.timing(mood, {
      toValue: MOOD[charge.state],
      duration: can('fade') ? 700 : 0,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [charge.state, mood, can]);
  const fillColor = mood.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [colors.positive, colors.warning, colors.negative],
  });

  // Personality: a slow, low-amplitude loop while it is on screen, only with full motion.
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    breath.setValue(0);
    if (!can('particles')) return;
    const period = charge.state === 'green' ? 3600 : charge.state === 'amber' ? 2400 : 1600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [charge.state, breath, can]);

  const fillOpacity =
    charge.state === 'green'
      ? breath.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] })
      : charge.state === 'amber'
        ? breath.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] })
        : 1;
  const bodyScale = charge.state === 'red' ? breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) : 1;

  return (
    <View accessible accessibilityLabel={`${percent} percent of what is in your accounts is free until payday. ${chargeNote(charge.state)}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Animated.View
          style={{
            width,
            height,
            borderRadius: height * 0.32,
            borderWidth: 2,
            borderColor: colors.textTertiary,
            padding: 2,
            transform: [{ scale: bodyScale }],
          }}
        >
          <View style={{ flex: 1, borderRadius: height * 0.2, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
            <Animated.View
              style={{
                width: inner,
                flex: 1,
                opacity: fillOpacity,
                transform: [{ translateX: level.interpolate({ inputRange: [0, 1], outputRange: [-inner, 0] }) }],
              }}
            >
              <Animated.View style={{ flex: 1, backgroundColor: fillColor }} />
            </Animated.View>
          </View>
        </Animated.View>
        <View style={{ width: 3, height: height * 0.4, marginLeft: 1, borderTopRightRadius: 2, borderBottomRightRadius: 2, backgroundColor: colors.textTertiary }} />
        <Text style={{ marginLeft: 12, fontSize: compact ? 15 : 18, fontWeight: '700', color: colors.textPrimary }}>{percent}%</Text>
      </View>
      <Text style={{ marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.textSecondary }}>
        of what is in your accounts is free until payday. {chargeNote(charge.state)}
      </Text>
    </View>
  );
};

const MOOD: Record<ChargeState, number> = { green: 0, amber: 1, red: 2 };
