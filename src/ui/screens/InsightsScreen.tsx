import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { shortDate } from '@/lib/date';
import { amountsInText } from '@/lib/amountsInText';
import type { Insight } from '@/analysis/insights';
import type { InsightsView } from '@/repo/analysisViews';
import { t, ink, line } from '../theme';
import { TAB_BAR_SPACE, useAmount } from '../kit';
import { Amount, EmptyState, InsightCard, ScreenHeader } from '../parts';
import { INSIGHT_LOOK } from '../insightLook';

export interface InsightsScreenProps {
  view: InsightsView;
  onEntryPress: (entryId: string) => void;
}

const MIN_MONTHS = 3;

/** A card shows this many of the entries behind its claim; the rest are one tap away. */
const SHOWN = 5;

/** One finding and the entries it rests on, each tappable so the claim can be checked. */
const Finding: React.FC<{
  insight: Insight;
  evidence: InsightsView['evidence'];
  onEntryPress: (entryId: string) => void;
}> = ({ insight, evidence, onEntryPress }) => {
  const amount = useAmount();
  const [all, setAll] = useState(false);
  const lines = insight.evidence.map((id) => evidence[id]).filter(Boolean);
  const shown = all ? lines : lines.slice(0, SHOWN);
  const look = INSIGHT_LOOK[insight.kind];

  return (
    <InsightCard eyebrow={look.eyebrow} icon={look.icon} headline={amountsInText(insight.sentence, amount)}>
      {lines.length > 0 && (
        <View className={`mt-3 border-t pt-1 ${line.border}`}>
          <Text className={`${t.faint} pb-1 pt-2`}>Based on</Text>
          {shown.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => onEntryPress(row.id)}
              accessibilityRole="button"
              className="flex-row items-center justify-between py-2"
            >
              <Text className={`${t.muted} flex-1 pr-4`} numberOfLines={1}>
                {shortDate(row.date)} · {row.name}
              </Text>
              <Amount value={row.amount} size="small" tone={row.amount > 0 ? 'positive' : 'muted'} />
            </Pressable>
          ))}
          {lines.length > SHOWN && (
            <Pressable onPress={() => setAll(!all)} className="py-2" accessibilityRole="button">
              <Text className={`text-[13px] font-semibold ${ink.accent}`}>
                {all ? 'Show fewer' : `Show all ${lines.length} transactions`}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </InsightCard>
  );
};

/** Each insight says what happened and shows the entries behind it. */
export const InsightsScreen: React.FC<InsightsScreenProps> = ({ view, onEntryPress }) => {
  const { insights, monthsOfHistory, evidence } = view;

  if (monthsOfHistory < MIN_MONTHS) {
    return (
      <View className={t.screen}>
        <ScreenHeader title="Insights" />
        <EmptyState
          icon="✨"
          title="Insights start after three months"
          body={`So a pattern is a pattern and not a coincidence. You have ${monthsOfHistory} ${
            monthsOfHistory === 1 ? 'month' : 'months'
          } of history so far.`}
        />
      </View>
    );
  }

  if (insights.length === 0) {
    return (
      <View className={t.screen}>
        <ScreenHeader title="Insights" />
        <EmptyState
          icon="✨"
          title="Nothing stands out this month"
          body="When something changes enough to notice, it will show up here with the transactions behind it."
        />
      </View>
    );
  }

  // Prices first: what things cost now is what this screen is most often opened for.
  const ordered = [
    ...insights.filter((i) => i.kind === 'price_move'),
    ...insights.filter((i) => i.kind !== 'price_move'),
  ];

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="Insights" subtitle="What changed, and the transactions that show it" />
      <View className={t.page}>
        {ordered.map((insight, index) => (
          <Finding key={`${insight.kind}-${index}`} insight={insight} evidence={evidence} onEntryPress={onEntryPress} />
        ))}

        <Text className={`${t.faint} pt-2 leading-4`}>
          These describe your spending. They never suggest where to put money.
        </Text>
      </View>
    </ScrollView>
  );
};
