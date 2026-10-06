import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { subtract } from '@/money/money';
import { shortDate, isoDate } from '@/lib/date';
import { renewalOnOrAfter, type SubscriptionSummary, type Cadence } from '@/analysis/subscriptions';
import type { SubscriptionsView } from '@/repo/analysisViews';
import { t, ink } from '../theme';
import { CategoryChip, TAB_BAR_SPACE, useAmount } from '../kit';
import { Amount, EmptyState, MoneyCard, ScreenHeader, SectionHeader } from '../parts';

export interface SubscriptionsScreenProps {
  view: SubscriptionsView;
}

const CADENCE: Record<Cadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every three months',
  yearly: 'Yearly',
  irregular: 'Irregular',
};

const Row: React.FC<{ summary: SubscriptionSummary; today: string; dormant?: boolean }> = ({
  summary,
  today,
  dormant,
}) => {
  const next = renewalOnOrAfter(summary, today);
  const amount = useAmount();
  const detail = dormant
    ? `Last charged ${summary.dormantSinceDays} days ago`
    : [CADENCE[summary.cadence], next ? `next ${shortDate(next)}` : undefined].filter(Boolean).join(' · ');

  return (
    <View className="flex-row items-center py-3.5">
      <CategoryChip name={summary.merchantName} size={42} />
      <View className="ml-3 flex-1 pr-3">
        <Text className={`text-[15px] font-semibold ${dormant ? ink.secondary : ink.primary}`} numberOfLines={1}>
          {summary.merchantName}
        </Text>
        <Text className={`${t.faint} mt-0.5`}>{detail}</Text>
        {summary.priceIncrease && !dormant && (
          <Text className={`mt-0.5 text-[12px] font-medium ${ink.negative}`}>
            Price up {amount(subtract(summary.priceIncrease.to, summary.priceIncrease.from))} from{' '}
            {amount(summary.priceIncrease.from)}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Amount value={summary.latestAmount} size="body" tone={dormant ? 'muted' : 'neutral'} />
        {!dormant && <Text className={`${t.faint} mt-0.5`}>{amount(summary.annualisedCost, { paise: false })} a year</Text>}
      </View>
    </View>
  );
};

export const SubscriptionsScreen: React.FC<SubscriptionsScreenProps> = ({ view }) => {
  const today = isoDate(new Date());
  const { active, dormant, totalAnnual, totalMonthly, sharedCategories } = view;
  const amount = useAmount();
  const [explaining, setExplaining] = useState(false);

  if (active.length === 0 && dormant.length === 0) {
    return (
      <ScrollView className={t.screen}>
        <ScreenHeader title="Subscriptions" />
        <EmptyState
          icon="🔁"
          title="No subscriptions detected"
          body="Hisaab will show recurring payments here when it finds a pattern in your transactions."
          action={{ label: explaining ? 'Hide' : 'How detection works', onPress: () => setExplaining(!explaining) }}
        />
        {explaining && (
          <Text className={`${t.muted} px-8 leading-5`}>
            A payment appears here once it has been charged three times at a steady interval for about the same
            amount. Transfers and investments are never counted as subscriptions.
          </Text>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="Subscriptions" />
      <View className={t.page}>
        {active.length > 0 ? (
          <MoneyCard>
            <Text className={t.label}>Every month</Text>
            <View className="mt-2 flex-row items-baseline">
              <Amount value={totalMonthly} size="hero" fit />
            </View>
            <Text className={`${t.muted} mt-1`}>
              {amount(totalAnnual, { paise: false })} a year across {active.length}{' '}
              {active.length === 1 ? 'subscription' : 'subscriptions'}
            </Text>
          </MoneyCard>
        ) : (
          <MoneyCard>
            <Text className={t.heading}>Nothing is charging you right now</Text>
            <Text className={`${t.muted} mt-1 leading-5`}>
              Hisaab found earlier subscriptions that have stopped. They are listed below.
            </Text>
          </MoneyCard>
        )}

        {sharedCategories.length > 0 && (
          <MoneyCard>
            <Text className={t.label}>Worth a look</Text>
            {sharedCategories.map((shared) => (
              <Text key={shared.category} className={`${t.body} mt-2 leading-5`}>
                {shared.merchants.length} under {shared.category}: {shared.merchants.join(', ')}.
              </Text>
            ))}
          </MoneyCard>
        )}

        {active.length > 0 && (
          <>
            <SectionHeader title="Active" />
            <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
              {active.map((summary, index) => (
                <View key={summary.merchantName}>
                  {index > 0 && <View className={`${t.rule} ml-14`} />}
                  <Row summary={summary} today={today} />
                </View>
              ))}
            </View>
          </>
        )}

        {dormant.length > 0 && (
          <View className="pt-6">
            <SectionHeader title="Not charged in 90 days" />
            <Text className={`${t.faint} -mt-1 mb-3 leading-4`}>
              Cancelled, or forgotten and about to come back. Either way, worth knowing.
            </Text>
            <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
              {dormant.map((summary, index) => (
                <View key={summary.merchantName}>
                  {index > 0 && <View className={`${t.rule} ml-14`} />}
                  <Row summary={summary} today={today} dormant />
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
};
