import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { CategoryFlow } from '@/repo/reports';
import { CategoryChip, useAmount, useInk } from '../kit';
import { BottomSheet, SmallButton } from '../parts';
import { Particle, along, life, track } from './Particle';
import { canMove } from './useMotion';
import { FLOW_MS } from './tokens';

/**
 * Where a category's money went, drawn as a flow rather than a pie: what came
 * in, the account it left, the category, and the payees inside it. The nodes
 * arrive one after another, a line grows between each pair and a particle
 * runs down it, so the order of events is the picture. Every figure is read
 * from the ledger (`categoryFlow`); nothing is estimated. With reduced motion
 * the nodes simply fade in together; with none they are there at once.
 */

/** One node, arriving at `at` on the clock (0 to 1). */
const appear = (p: Animated.Value, at: number, gapY = 10) => ({
  opacity: p.interpolate({ inputRange: [0, at, Math.min(1, at + 0.1)], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
  transform: [{ translateY: track(p, gapY, 0, at, Math.min(1, at + 0.14)) }],
});

const LINE = 22;

/** The line between two nodes: grows down from the first, with a particle running along it. */
const Connector: React.FC<{ p: Animated.Value; from: number; motion: boolean }> = ({ p, from, motion }) => {
  const { colors } = useInk();
  const end = Math.min(1, from + 0.12);
  const path = [
    { x: 0, y: 0 },
    { x: 0, y: LINE },
  ];
  const run = along(p, path, from, end);
  return (
    <View style={{ height: LINE, alignItems: 'center' }}>
      <Animated.View
        style={{
          width: 2,
          height: LINE,
          borderRadius: 1,
          backgroundColor: colors.border,
          opacity: p.interpolate({ inputRange: [0, from, end], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
          transform: [{ scaleY: track(p, 0.01, 1, from, end) }],
        }}
      />
      {motion && (
        <Particle
          color={colors.accent}
          size={5}
          style={{ opacity: life(p, from, end + 0.02), transform: [{ translateX: run.x }, { translateY: run.y }] }}
        />
      )}
    </View>
  );
};

const Node: React.FC<{ p: Animated.Value; at: number; children: React.ReactNode; tint?: boolean }> = ({ p, at, children, tint }) => {
  const { colors } = useInk();
  return (
    <Animated.View
      style={[
        {
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: 18,
          backgroundColor: colors.surfaceElevated,
          borderWidth: 1,
          borderColor: tint ? colors.accent : colors.border,
        },
        appear(p, at),
      ]}
    >
      {children}
    </Animated.View>
  );
};

export const CategoryFlowSheet: React.FC<{
  flow: CategoryFlow | null;
  visible: boolean;
  onClose: () => void;
  onSeeAll: (category: string) => void;
}> = ({ flow, visible, onClose, onSeeAll }) => {
  const { colors } = useInk();
  const show = useAmount();
  const p = useRef(new Animated.Value(0)).current;
  const travel = canMove('travel');

  useEffect(() => {
    if (!visible) return;
    if (!canMove('fade')) {
      p.setValue(1);
      return;
    }
    p.setValue(0);
    const run = Animated.timing(p, { toValue: 1, duration: travel ? FLOW_MS : 400, easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [visible, flow?.category.name, p, travel]);

  // Without travel everything arrives together; with it, one after another.
  const t = travel
    ? { received: 0.02, account: 0.2, category: 0.38, payees: 0.58 }
    : { received: 0, account: 0, category: 0, payees: 0 };

  const label = (text: string) => (
    <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: colors.textTertiary, textTransform: 'uppercase' }}>{text}</Text>
  );
  const figure = (amount: number, size = 20) => (
    <Text style={{ fontSize: size, fontWeight: '700', color: colors.textPrimary }}>{show(amount as never, { paise: false })}</Text>
  );

  const payees = flow ? [...flow.merchants.map((m) => ({ name: m.name, amount: m.amount })), ...(flow.others > 0 ? [{ name: 'Others', amount: flow.others }] : [])] : [];

  return (
    <BottomSheet visible={visible && !!flow} onClose={onClose} title={flow ? `Where ${flow.category.name} went` : undefined}>
      {flow && (
        <View>
          {flow.received > 0 && (
            <>
              <Node p={p} at={t.received}>
                {label(`${flow.source?.name ?? 'Received'} · ${flow.month.label}`)}
                <View style={{ marginTop: 2 }}>{figure(flow.received, 22)}</View>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>came in this month</Text>
              </Node>
              <Connector p={p} from={t.received + 0.1} motion={travel} />
            </>
          )}

          <Node p={p} at={t.account}>
            {label(flow.accounts.length === 1 ? 'From' : 'From these accounts')}
            {flow.accounts.slice(0, 3).map((a) => (
              <View key={a.name} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>{a.name}</Text>
                {figure(a.amount, 15)}
              </View>
            ))}
          </Node>
          <Connector p={p} from={t.account + 0.1} motion={travel} />

          <Node p={p} at={t.category} tint>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <CategoryChip name={flow.category.name} size={40} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>{flow.category.name}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>
                  {flow.category.shareOfSpending}% of what you spent
                  {flow.category.shareOfReceived !== undefined ? ` · ${flow.category.shareOfReceived}% of what came in` : ''}
                </Text>
              </View>
              {figure(flow.category.amount, 20)}
            </View>
          </Node>
          <Connector p={p} from={t.category + 0.1} motion={travel} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {payees.map((payee, i) => (
              <Animated.View
                key={payee.name}
                style={[
                  {
                    width: '48.5%',
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 16,
                    backgroundColor: colors.surfaceMuted,
                  },
                  appear(p, Math.min(0.9, t.payees + i * 0.07), 8),
                ]}
              >
                <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textSecondary }}>{payee.name}</Text>
                <View style={{ marginTop: 2 }}>{figure(payee.amount, 16)}</View>
              </Animated.View>
            ))}
          </View>

          <View style={{ marginTop: 18 }}>
            <SmallButton label="See these transactions" onPress={() => onSeeAll(flow.category.name)} outline flex={false} />
          </View>
        </View>
      )}
    </BottomSheet>
  );
};
