import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Animated, Easing } from 'react-native';
import { Paise } from '@/money/money';
import { t } from '../theme';
import { useAmount, CategoryChip, useInk } from '../kit';
import { useAnchor } from '../motion/anchors';
import { DURATION, EASE, SPRING } from '../motion/tokens';
import { canMove } from '../motion/useMotion';

export type ReviewCard = {
  id: string;
  narration: string;
  amount: Paise;
  bestGuess: string;
  alternatives: string[];
};

export interface ReviewQueueScreenProps {
  cards: ReviewCard[];
  onAccept?: (cardId: string, category: string) => void;
  onSkip?: (cardId: string) => void;
  onDone?: () => void;
}

const ENTER = Easing.bezier(...EASE.out);

/** How long a filed transaction stays on screen before the next one arrives. */
const SETTLE_MS = 720;
const SETTLE_REDUCED_MS = 380;

/**
 * "Unknown" turning into a category: the grey word gives way to the category's
 * own chip, which snaps in, and a line says where it was filed. The recorded
 * answer is already saved by the time this plays; it only shows the result.
 */
const Settled: React.FC<{ category: string }> = ({ category }) => {
  const { colors } = useInk();
  const chip = useRef(new Animated.Value(0)).current;
  const anchor = useAnchor('reviewed');

  useEffect(() => {
    if (!canMove('fade')) {
      chip.setValue(1);
      return;
    }
    Animated.spring(chip, { toValue: 1, useNativeDriver: true, ...SPRING.snap }).start();
  }, [chip]);

  return (
    <View className="items-center pt-10">
      <View ref={anchor} collapsable={false} style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            position: 'absolute',
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 14,
            backgroundColor: colors.surfaceMuted,
            opacity: chip.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
            transform: [{ scale: chip.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0.85], extrapolate: 'clamp' }) }],
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textTertiary }}>Unknown</Text>
        </Animated.View>
        <Animated.View
          style={{
            opacity: chip.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
            transform: [{ scale: chip.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }],
          }}
        >
          <CategoryChip name={category} size={72} />
        </Animated.View>
      </View>
      <Animated.View
        style={{
          marginTop: 14,
          opacity: chip.interpolate({ inputRange: [0.3, 0.8], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateY: chip.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        }}
      >
        <Text style={{ fontSize: 15, color: colors.textSecondary }}>
          Filed under <Text style={{ fontWeight: '700', color: colors.textPrimary }}>{category}</Text>
        </Text>
      </Animated.View>
    </View>
  );
};

export const ReviewQueueScreen: React.FC<ReviewQueueScreenProps> = ({
  cards: live,
  onAccept,
  onSkip,
  onDone,
}) => {
  // The queue as it was when the screen opened. Filing a card takes it out of the live list, so
  // walking the live list by position would skip every other card.
  const [cards] = useState(live);
  const [index, setIndex] = useState(0);
  const [filed, setFiled] = useState<string>();
  const amount = useAmount();
  const arrive = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Each new card slides up a little as it arrives.
  useEffect(() => {
    if (!canMove('fade')) return;
    arrive.setValue(0);
    Animated.timing(arrive, { toValue: 1, duration: DURATION.micro.card, easing: ENTER, useNativeDriver: true }).start();
  }, [index, arrive]);

  const advance = () => {
    setFiled(undefined);
    if (index + 1 >= cards.length) {
      onDone?.();
      return;
    }
    setIndex(index + 1);
  };

  if (cards.length === 0 || index >= cards.length) {
    return (
      <View className={`${t.screen} items-center justify-center px-10`}>
        <Text className={t.heading}>Nothing to review</Text>
        <Text className={`${t.muted} mt-2 text-center`}>
          Every transaction has a category.
        </Text>
      </View>
    );
  }

  const card = cards[index];

  const file = (category: string) => {
    if (filed) return;
    // Saved at once; the rest is only the showing of it.
    onAccept?.(card.id, category);
    if (!canMove('fade') && !canMove('amount')) return advance();
    setFiled(category);
    timer.current = setTimeout(advance, canMove('travel') ? SETTLE_MS : SETTLE_REDUCED_MS);
  };

  return (
    <View className={t.screen}>
      <View className={`${t.page} pt-6`}>
        <View className="flex-row items-center gap-3">
          <View className="h-[3px] flex-1 overflow-hidden rounded-full bg-surfaceMuted dark:bg-surfaceMuted-dark">
            <View
              className="h-full rounded-full bg-textPrimary dark:bg-textPrimary-dark"
              style={{ width: `${((index + (filed ? 1 : 0.5)) / cards.length) * 100}%` }}
            />
          </View>
          <Text className={t.faint}>
            {index + 1}/{cards.length}
          </Text>
        </View>
      </View>

      <Animated.View
        style={{
          flex: 1,
          opacity: arrive,
          transform: [{ translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        }}
      >
        <ScrollView contentContainerClassName="pb-8">
          <View className={`${t.page} pt-10`}>
            <Text className={t.figure}>{amount(card.amount)}</Text>

            <View className="mt-5">
              <Text className={t.label}>As the bank wrote it</Text>
              <Text className={`${t.muted} mt-2 font-mono`}>{card.narration}</Text>
            </View>
          </View>

          {filed ? (
            <Settled category={filed} />
          ) : (
            <View className={`${t.page} pt-10`}>
              <Text className={`${t.label} mb-3`}>Best guess</Text>
              <Pressable onPress={() => file(card.bestGuess)} className={`${t.card} border-textPrimary dark:border-textPrimary-dark`}>
                <Text className={t.heading}>{card.bestGuess}</Text>
              </Pressable>

              <Text className={`${t.label} mb-3 mt-8`}>Or</Text>
              {card.alternatives.map((alt, i) => (
                <View key={alt}>
                  {i > 0 && <View className={t.rule} />}
                  <Pressable onPress={() => file(alt)} className="py-4">
                    <Text className={t.body}>{alt}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </Animated.View>

      <View className={`${t.page} pb-8`}>
        <Pressable
          disabled={!!filed}
          onPress={() => {
            onSkip?.(card.id);
            advance();
          }}
          className={t.ghostButton}
          style={filed ? { opacity: 0.4 } : undefined}
        >
          <Text className={t.ghostLabel}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
};
