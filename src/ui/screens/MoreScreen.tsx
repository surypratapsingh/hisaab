import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { t, bg, ink } from '../theme';
import { TAB_BAR_SPACE, Icon, useInk } from '../kit';
import { ScreenHeader } from '../parts';

export type MoreTarget =
  | 'Accounts'
  | 'Settings'
  | 'Wealth'
  | 'Budgets'
  | 'Goals'
  | 'Recurring'
  | 'Subscriptions'
  | 'Insights'
  | 'Messages'
  | 'Items'
  | 'ScanPay';

export interface MoreScreenProps {
  onOpen: (target: MoreTarget) => void;
  /** Small notes shown beside a row, only when there is something to say. */
  notes?: Partial<Record<MoreTarget, string>>;
}

type Row = { target: MoreTarget; title: string; about: string; symbol: string };

const SECTIONS: Array<{ title: string; rows: Row[] }> = [
  {
    title: 'Your money',
    rows: [
      { target: 'Accounts', title: 'Accounts', about: 'Where your money is', symbol: '🏦' },
      { target: 'Wealth', title: 'Wealth', about: 'Everything you own', symbol: '📊' },
      { target: 'Settings', title: 'Settings', about: 'Appearance and your data', symbol: '⚙️' },
    ],
  },
  {
    title: 'Plan ahead',
    rows: [
      { target: 'Budgets', title: 'Budgets', about: 'A limit for a category, month to month', symbol: '🎯' },
      { target: 'Goals', title: 'Goals', about: 'Money you are putting aside', symbol: '🏁' },
      { target: 'Recurring', title: 'Recurring', about: 'Rent, bills and payments due', symbol: '🗓️' },
      { target: 'Subscriptions', title: 'Subscriptions', about: 'Regular charges Hisaab found', symbol: '🔁' },
    ],
  },
  {
    title: 'Understand',
    rows: [
      { target: 'Insights', title: 'Insights', about: 'What changed, with evidence', symbol: '✨' },
      { target: 'Items', title: 'Items', about: 'What you buy and its prices', symbol: '🛒' },
      { target: 'Messages', title: 'Messages', about: 'Bank and UPI alerts read', symbol: '💬' },
    ],
  },
  {
    title: 'Quick actions',
    rows: [{ target: 'ScanPay', title: 'Scan and pay', about: 'Pay any UPI code', symbol: '⌁' }],
  },
];

/** Everything that is not one of the four main tabs, in one place. */
export const MoreScreen: React.FC<MoreScreenProps> = ({ onOpen, notes = {} }) => {
  const { colors } = useInk();
  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="More" />
      <View className="px-5">
        {SECTIONS.map((section) => (
          <View key={section.title} className="mb-5">
            <Text className={`${t.label} mb-2 ml-1`}>{section.title}</Text>
            <View className={`${t.card} py-1`} style={{ paddingHorizontal: 0 }}>
              {section.rows.map((row, index) => (
                <View key={row.target}>
                  {index > 0 && <View className={`${t.rule} ml-16`} />}
                  <Pressable
                    onPress={() => onOpen(row.target)}
                    accessibilityRole="button"
                    android_ripple={{ color: colors.surfaceMuted }}
                    className="flex-row items-center px-4 py-3.5"
                  >
                    <View className={`h-10 w-10 items-center justify-center rounded-xl ${bg.muted}`}>
                      <Text style={{ fontSize: 18 }}>{row.symbol}</Text>
                    </View>
                    <View className="ml-3 flex-1 pr-2">
                      <Text className={`text-[15px] font-semibold ${ink.primary}`}>{row.title}</Text>
                      <Text className={`${t.faint} mt-0.5`} numberOfLines={1}>{notes[row.target] ?? row.about}</Text>
                    </View>
                    <Icon name="chevron" size={16} color={colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};
