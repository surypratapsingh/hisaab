import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { isNegative, subtract, paise, type Paise } from '@/money/money';
import type { WealthView } from '@/wealth/repo';
import { wealthSplit } from '@/wealth/split';
import { t, bg, ink, line } from './theme';
import { Icon, useInk } from './kit';
import { useLedger } from './store';
import { IconButton, Amount } from './parts';
import { PressableScale } from './press';
import { AmountTransition } from './motion/AmountTransition';
import { useAnchor } from './motion/anchors';
import { MotionLab } from './motion/MotionLab';

const greeting = (hour: number): string => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');

/**
 * The top of Home: who is looking, everything owned in one figure that can be
 * hidden, how this month moved it, and where it sits (bank and cash,
 * investments, other). Every number comes from the wealth view; nothing here
 * is worked out again.
 */
export const WealthHero: React.FC<{
  wealth: WealthView;
  /** Received less spent this month. */
  monthNet: Paise;
  onRefresh: () => void;
  onOpen: () => void;
  onLock: () => void;
  onProfile?: () => void;
  onScan?: () => void;
}> = ({ wealth, monthNet, onRefresh, onOpen, onLock, onProfile, onScan }) => {
  const { colors } = useInk();
  const [lab, setLab] = useState(false);
  const heroAnchor = useAnchor('hero');
  const investAnchor = useAnchor('invest');
  const hidden = useLedger((s) => s.hideAmounts);
  const toggle = useLedger((s) => s.toggleHideAmounts);
  const split = wealthSplit(wealth);
  const now = new Date();
  const up = !isNegative(monthNet);

  const tiles: Array<{ label: string; value: Paise }> = [
    { label: 'Bank & cash', value: split.bankAndCash },
    { label: 'Investments', value: split.investments },
    ...(split.other !== 0 ? [{ label: 'Other', value: split.other }] : []),
  ];

  return (
    <View className="px-5 pt-4">
      <View className="flex-row items-start justify-between">
        <Pressable onLongPress={__DEV__ ? () => setLab(true) : undefined} delayLongPress={700}>
          <Text className={`text-[22px] font-semibold ${ink.primary}`}>{greeting(now.getHours())}</Text>
          <Text className={`${t.muted} mt-0.5`}>
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        </Pressable>
        <View className="flex-row gap-2">
          <IconButton icon={hidden ? 'eye' : 'eyeOff'} label={hidden ? 'Show amounts' : 'Hide amounts'} onPress={toggle} size={40} />
          <IconButton icon="lock" label="Lock Hisaab" onPress={onLock} size={40} />
          {onProfile && <IconButton icon="user" label="Accounts and settings" onPress={onProfile} size={40} />}
        </View>
      </View>

      <View ref={heroAnchor} collapsable={false} style={{ marginTop: 28 }}>
        <PressableScale onPress={onOpen} scale={0.99} accessibilityLabel="Total wealth. Open wealth.">
          <Text className={t.label}>Total wealth</Text>
          <View style={{ marginTop: 6 }}>
            <AmountTransition
              value={wealth.total}
              slot="wealth"
              style={{ fontSize: 40, fontWeight: '700', letterSpacing: -1, color: colors.textPrimary }}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
          </View>
        </PressableScale>
      </View>

      <View className="mt-3 flex-row items-center self-start">
        <View
          className="flex-row items-center rounded-full px-3 py-1.5"
          style={{ backgroundColor: up ? `${colors.positive}1F` : `${colors.negative}1F` }}
        >
          <Icon name={up ? 'up' : 'down'} size={13} color={up ? colors.positive : colors.negative} />
          <View className="ml-1">
            <Amount value={up ? monthNet : subtract(paise(0), monthNet)} size="small" tone={up ? 'positive' : 'negative'} animate />
          </View>
          <Text className={`ml-1 text-[13px] ${ink.secondary}`}>this month</Text>
        </View>
      </View>

      <View className="mt-5 flex-row gap-3">
        {tiles.map((tile) => (
          <View key={tile.label} ref={tile.label === 'Investments' ? investAnchor : undefined} collapsable={false} style={{ flex: 1 }}>
            <Pressable onPress={onOpen} className={`rounded-2xl border ${line.border} ${bg.surface} px-3.5 py-3`}>
              <Text className={t.faint} numberOfLines={1}>{tile.label}</Text>
              <View className="mt-1">
                <Amount value={tile.value} size="body" animate />
              </View>
            </Pressable>
          </View>
        ))}
      </View>

      <View className="mt-4 flex-row gap-3">
        {onScan && (
          <PressableScale onPress={onScan} accessibilityRole="button" scale={0.98} style={{ flex: 1 }} className={`rounded-2xl ${bg.accent} py-3.5`}>
            <Text className={t.primaryLabel}>Scan and pay</Text>
          </PressableScale>
        )}
        <PressableScale onPress={onRefresh} accessibilityRole="button" scale={0.98} style={{ flex: 1.25 }} className={t.ghostButton.replace('py-4', 'py-3.5')}>
          <Text className={`${t.ghostLabel} text-[14px]`} numberOfLines={1}>Refresh investments</Text>
        </PressableScale>
      </View>
      {__DEV__ && <MotionLab visible={lab} onClose={() => setLab(false)} />}
    </View>
  );
};
