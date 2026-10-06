import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { paise } from '@/money/money';
import { CategoryChip, useAmount, useInk } from '../kit';
import { Particle, along, life, track } from './Particle';
import { countAt } from './numbers';
import { SCENE_MS, storyOf, type Scene, type StoryInput } from './story';
import { canMove } from './useMotion';

/** A figure that counts up from nothing when its scene appears (or is simply there, with reduced motion). */
const Counting: React.FC<{ value: number; size: number; color: string }> = ({ value, size, color }) => {
  const show = useAmount();
  const [n, setN] = useState(canMove('amount') ? 0 : value);

  useEffect(() => {
    if (!canMove('amount')) return setN(value);
    const started = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame>;
    const step = () => {
      const progress = (Date.now() - started - 150) / 950;
      // Whole rupees on the way up, so the figure never shows a passing fraction.
      setN(progress >= 1 ? value : Math.round(countAt(0, value, progress) / 100) * 100);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: size, fontWeight: '800', letterSpacing: -1, color }}>
      {show(paise(n), { paise: false })}
    </Text>
  );
};

/** One scene: fades up on arrival. */
const SceneView: React.FC<{ scene: Scene }> = ({ scene }) => {
  const { colors } = useInk();
  const show = useAmount();
  const { width } = useWindowDimensions();
  const p = useRef(new Animated.Value(canMove('fade') ? 0 : 1)).current;

  useEffect(() => {
    if (!canMove('fade')) return;
    const run = Animated.timing(p, { toValue: 1, duration: SCENE_MS[scene.key] - 200, easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [p, scene.key]);

  const fade = {
    opacity: p.interpolate({ inputRange: [0, 0.12], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: track(p, 14, 0, 0, 0.2) }],
  };
  const kicker = (text: string) => (
    <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 3, color: colors.textTertiary, marginBottom: 14 }}>{text}</Text>
  );
  const caption = (text: string) => <Text style={{ fontSize: 20, fontWeight: '500', color: colors.textSecondary, marginTop: 6 }}>{text}</Text>;

  if (scene.key === 'received') {
    return (
      <Animated.View style={[{ paddingHorizontal: 32 }, fade]}>
        {kicker(scene.kicker)}
        <Counting value={scene.amount} size={56} color={colors.positive} />
        {caption(scene.line)}
      </Animated.View>
    );
  }

  if (scene.key === 'spent') {
    return (
      <Animated.View style={[{ paddingHorizontal: 32 }, fade]}>
        <Counting value={scene.amount} size={56} color={colors.textPrimary} />
        {caption(scene.line)}
      </Animated.View>
    );
  }

  if (scene.key === 'kept') {
    return (
      <Animated.View style={[{ paddingHorizontal: 32 }, fade]}>
        <Counting value={scene.amount} size={56} color={scene.positive ? colors.accent : colors.textPrimary} />
        {caption(scene.line)}
      </Animated.View>
    );
  }

  if (scene.key === 'streams') {
    const top = scene.rows[0]?.amount || 1;
    const travel = canMove('travel');
    const barW = width - 64 - 52;
    return (
      <Animated.View style={[{ paddingHorizontal: 32 }, fade]}>
        <Text style={{ fontSize: 20, fontWeight: '500', color: colors.textSecondary, marginBottom: 18 }}>{scene.line}</Text>
        {scene.rows.map((row, i) => {
          const start = 0.08 + i * 0.09;
          const end = Math.min(1, start + 0.45);
          const reach = Math.max(0.12, row.amount / top) * barW;
          const run = along(p, [{ x: 0, y: 0 }, { x: reach, y: 0 }], start, end);
          return (
            <View key={row.name} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <CategoryChip name={row.name} size={40} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary }}>{row.name}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>{show(paise(row.amount), { paise: false })}</Text>
                  </View>
                  <View style={{ height: 6, marginTop: 8, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
                    <Animated.View
                      style={{
                        height: 6,
                        width: reach,
                        borderRadius: 3,
                        backgroundColor: colors.accent,
                        transform: [{ translateX: track(p, -reach, 0, start, end) }],
                      }}
                    />
                  </View>
                  {travel && (
                    <View style={{ position: 'absolute', left: 0, bottom: 3 }}>
                      <Particle color={colors.accent} size={5} style={{ opacity: life(p, start, end + 0.02), transform: [{ translateX: run.x }] }} />
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </Animated.View>
    );
  }

  // summary
  return (
    <View style={{ paddingHorizontal: 32 }}>
      <Animated.View style={fade}>{kicker(scene.kicker)}</Animated.View>
      {scene.lines.map((line, i) => (
        <Animated.Text
          key={line.text}
          style={{
            fontSize: 22,
            lineHeight: 30,
            fontWeight: '600',
            color: colors.textPrimary,
            marginBottom: 12,
            opacity: p.interpolate({ inputRange: [0.1 + i * 0.16, 0.24 + i * 0.16], outputRange: [0, 1], extrapolate: 'clamp' }),
          }}
        >
          {line.amount !== undefined ? line.text.replace('{amount}', show(paise(line.amount), { paise: false })) : line.text}
        </Animated.Text>
      ))}
    </View>
  );
};

/**
 * "Your September": a short optional walk through the month, five scenes and
 * under eight seconds. Tap to go on, Skip to leave; it stays on the last scene
 * until closed. Nothing is required to understand: every scene is text and
 * figures from the report, and the movement only decorates them.
 */
export const MoneyStory: React.FC<{ story: StoryInput | null; visible: boolean; onClose: () => void }> = ({ story, visible, onClose }) => {
  const { colors } = useInk();
  const scenes = React.useMemo(() => (story ? storyOf(story) : []), [story]);
  const [index, setIndex] = useState(0);
  const last = index >= scenes.length - 1;

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible || last) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), SCENE_MS[scenes[index].key]);
    return () => clearTimeout(timer);
  }, [visible, index, last, scenes]);

  const scene = scenes[Math.min(index, scenes.length - 1)];

  return (
    <Modal visible={visible && !!scene} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={last ? 'Close the story' : 'Next'}
        onPress={() => (last ? onClose() : setIndex(index + 1))}
        style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}
      >
        <View style={{ position: 'absolute', top: 56, left: 24, right: 24, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
            {scenes.map((s, i) => (
              <View key={s.key} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= index ? colors.textPrimary : colors.surfaceMuted, opacity: i <= index ? 1 : 0.7 }} />
            ))}
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip" style={{ marginLeft: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>{last ? 'Done' : 'Skip'}</Text>
          </Pressable>
        </View>
        {scene && <SceneView key={scene.key} scene={scene} />}
      </Pressable>
    </Modal>
  );
};
