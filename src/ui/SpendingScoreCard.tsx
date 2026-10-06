import React from 'react';
import { View, Text } from 'react-native';
import type { SpendingScore } from '@/analysis/spendingScore';
import { t, ink, line } from './theme';
import { useAmount } from './kit';
import { ProgressBar } from './parts';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

const Run: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <View className={`flex-1 rounded-2xl border ${line.border} px-3.5 py-3`}>
    <Text className={t.faint}>{label}</Text>
    <Text className={`mt-1 text-[18px] font-semibold ${ink.primary}`}>{days(value)}</Text>
  </View>
);

/**
 * This month's days against the user's own daily average from before it: how many came in
 * under, the run up to today and the longest run. A count of days, never a verdict.
 */
export const SpendingScoreCard: React.FC<{ score: SpendingScore; monthName: string }> = ({ score, monthName }) => {
  const amount = useAmount();
  const share = score.days > 0 ? Math.round((score.under / score.days) * 100) : 0;
  return (
    <View className={t.card}>
      <View className="flex-row items-end">
        <Text className={`text-[30px] font-bold ${ink.primary}`}>{score.under}</Text>
        <Text className={`${t.muted} mb-1.5 ml-1.5`}>of {days(score.days)} under your daily average</Text>
      </View>
      <View className="mt-3">
        <ProgressBar value={share} />
      </View>
      <View className="mt-4 flex-row gap-3">
        <Run label="In a row, up to today" value={score.streak} />
        <Run label={`Longest in ${monthName}`} value={score.best} />
      </View>
      <Text className={`${t.faint} mt-3 leading-4`}>
        Daily average {amount(score.average, { paise: false })}: what went out over the {score.basisDays} days before{' '}
        {monthName}, divided by {score.basisDays}. Today counts as it stands so far.
      </Text>
    </View>
  );
};
