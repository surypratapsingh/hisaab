import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { sum, type Paise } from '@/money/money';
import { shortDate } from '@/lib/date';
import { monthKeyOf, type ReportView, type ReportSide } from '@/repo/reports';
import { t, bg, ink, line } from '../theme';
import { TAB_BAR_SPACE, useAmount, useInk, CategoryChip, categoryLook, categoryTint, Icon } from '../kit';
import { REPORTS, type ReportKind } from '@/reports/doc';
import { Amount, EmptyState, MoneyCard, ScreenHeader, SectionHeader, SegmentedControl } from '../parts';
import type { CategoryFlow } from '@/repo/reports';
import { CategoryFlowSheet } from '../motion/CategoryFlowSheet';
import { MoneyStory } from '../motion/MoneyStory';
import type { StoryInput } from '../motion/story';

const SIDES: readonly ReportSide[] = ['expense', 'income'];
const SIDE_NAMES: Record<ReportSide, string> = { expense: 'Expense', income: 'Income' };

export interface ReportsScreenProps {
  view: ReportView;
  onMonthChange: (key: string) => void;
  onSideChange: (side: ReportSide) => void;
  /** Opens the ledger searched for this category. */
  onCategoryPress?: (name: string) => void;
  /** Opens one of the Financial reports for the month shown. */
  onReportPress?: (kind: ReportKind) => void;
  /** Where one spending category's money went this month; read only when a category is tapped. */
  flowFor?: (name: string) => CategoryFlow | null;
  /** The month's figures for its story (spending side), read only when the story is opened. */
  storyFor?: () => StoryInput | null;
  onEntryPress?: (entryId: string) => void;
}

/** "↑ 25% · last month ₹40,000", coloured by whether the change is good for that figure. */
const Change: React.FC<{ change?: number; before: Paise; goodIsUp: boolean }> = ({ change, before, goodIsUp }) => {
  const amount = useAmount();
  if (change === undefined) return <Text className={`${t.faint} mt-1`}>Nothing to compare with yet</Text>;
  const good = (change >= 0) === goodIsUp;
  return (
    <Text className={`mt-1.5 text-[13px] font-semibold ${good ? ink.positive : ink.negative}`}>
      {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%{' '}
      <Text className={`${t.faint} font-normal`}>· month before {amount(before, { paise: false })}</Text>
    </Text>
  );
};

const Tile: React.FC<{ label: string; value: React.ReactNode; note?: string }> = ({ label, value, note }) => (
  <View className={`flex-1 rounded-2xl ${bg.muted}`} style={{ padding: 14 }}>
    <Text className={t.faint}>{label}</Text>
    <View className="mt-1">{value}</View>
    {note ? <Text className={`${t.faint} mt-0.5`}>{note}</Text> : null}
  </View>
);

/**
 * Income beside spending for six months, each month a pair of bars. A month
 * that has anything in it can be tapped to open it. Plain styles for the bars:
 * className sizes beside a style object let a bar fill the screen on Android.
 */
const CashFlow: React.FC<{
  flow: ReportView['flow'];
  months: ReportView['months'];
  shown: string;
  onPick: (key: string) => void;
}> = ({ flow, months, shown, onPick }) => {
  const amount = useAmount();
  const { colors } = useInk();
  const top = Math.max(1, ...flow.flatMap((f) => [f.income, f.expense]));
  const bar = (value: number) => (value > 0 ? Math.max(3, Math.round((value / top) * 84)) : 0);
  const income = sum(flow.map((f) => f.income));
  const expense = sum(flow.map((f) => f.expense));

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {flow.map((f) => {
          const openable = months.some((m) => m.key === f.key);
          const chosen = f.key === shown;
          return (
            <Pressable
              key={f.key}
              disabled={!openable}
              onPress={() => onPick(f.key)}
              accessibilityLabel={`${f.label}: ${amount(f.income, { paise: false })} in, ${amount(f.expense, { paise: false })} out`}
              style={{ flex: 1, alignItems: 'center' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 84, gap: 3 }}>
                <View style={{ width: 10, height: bar(f.income), borderRadius: 3, backgroundColor: colors.positive }} />
                <View style={{ width: 10, height: bar(f.expense), borderRadius: 3, backgroundColor: colors.negative }} />
              </View>
              <Text className={`mt-2 text-[12px] ${chosen ? `font-semibold ${ink.primary}` : ink.tertiary}`}>{f.label}</Text>
              <View
                style={{
                  height: 2,
                  width: 16,
                  marginTop: 3,
                  borderRadius: 1,
                  backgroundColor: chosen ? colors.textPrimary : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-3 flex-row items-center gap-4">
        <View className="flex-row items-center">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.positive, marginRight: 6 }} />
          <Text className={t.faint}>In</Text>
        </View>
        <View className="flex-row items-center">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.negative, marginRight: 6 }} />
          <Text className={t.faint}>Out</Text>
        </View>
      </View>
      <Text className={`${t.faint} mt-2`}>
        Across these six months {amount(income, { paise: false })} came in and {amount(expense, { paise: false })} went out.
      </Text>
    </View>
  );
};

/** What came in or went out on every day of the month; the busiest day is drawn in full ink. */
const DailyBars: React.FC<{ daily: ReportView['daily'] }> = ({ daily }) => {
  const { colors } = useInk();
  const max = Math.max(1, ...daily.map((d) => d.amount));
  const shown = [1, 8, 15, 22, daily.length];
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 }}>
        {daily.map((d) => (
          <View
            key={d.day}
            style={{
              flex: 1,
              height: Math.max(2, Math.round((d.amount / max) * 110)),
              borderRadius: 2,
              backgroundColor: d.amount === max && d.amount > 0 ? colors.accent : `${colors.textTertiary}59`,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {shown.map((day) => (
          <Text key={day} className={t.faint}>
            {day}
          </Text>
        ))}
      </View>
    </View>
  );
};

/** What happened in a month: the totals, six months of cash flow, each day, each category. */
export const ReportsScreen: React.FC<ReportsScreenProps> = ({ view, onMonthChange, onSideChange, onCategoryPress, onReportPress, onEntryPress, flowFor, storyFor }) => {
  const amount = useAmount();
  const [flow, setFlow] = useState<CategoryFlow | null>(null);
  const [story, setStory] = useState<StoryInput | null>(null);

  // Tapping a category on the spending side draws where its money went; the transactions are one tap on.
  const openCategory = (name: string) => {
    const drawn = isExpense ? flowFor?.(name) : null;
    if (drawn) setFlow(drawn);
    else onCategoryPress?.(name);
  };
  const { dark } = useInk();
  const top = view.categories[0];
  const inProgress = view.month.key === monthKeyOf(new Date());
  const isExpense = view.side === 'expense';
  const total = isExpense ? view.expense : view.income;
  const change = isExpense ? view.expenseChange : view.incomeChange;
  const before = isExpense ? view.previous.expense : view.previous.income;

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="Reports" subtitle="What happened, month by month" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 8 }}>
        {view.months.map((m) => {
          const chosen = m.key === view.month.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => onMonthChange(m.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              className={`rounded-full border px-4 py-2 ${
                chosen ? 'border-textPrimary bg-textPrimary dark:border-textPrimary-dark dark:bg-textPrimary-dark' : `${line.border} ${bg.surface}`
              }`}
            >
              <Text className={`text-[13px] font-medium ${chosen ? 'text-background dark:text-background-dark' : ink.secondary}`}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className={t.page}>
        <SegmentedControl options={SIDES} value={view.side} onChange={onSideChange} labelFor={(s) => SIDE_NAMES[s]} />

        <View className="mt-4">
          <MoneyCard>
            <Text className={t.label}>
              {isExpense ? 'Spent' : 'Received'} in {view.month.label}
              {inProgress ? ' so far' : ''}
            </Text>
            <View className="mt-2">
              <Amount value={total} size="hero" paise={false} fit />
            </View>
            <Change change={change} before={before} goodIsUp={!isExpense} />
            {inProgress && change !== undefined && (
              <Text className={`${t.faint} mt-1`}>This month is not over, so it is set against the whole month before.</Text>
            )}
            <View className={`${t.rule} my-4`} />
            <View className="flex-row items-baseline justify-between">
              <Text className={t.muted}>Left over</Text>
              <Amount value={view.net} size="body" tone="auto" signed paise={false} />
            </View>
            <Text className={`${t.faint} mt-1`}>
              {view.transactions} transaction{view.transactions === 1 ? '' : 's'}
            </Text>
          </MoneyCard>
        </View>

        {storyFor && view.transactions > 0 && (
          <MoneyCard onPress={() => setStory(storyFor())} gap={16} accessibilityLabel={`Your ${view.month.label} story`}>
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text className={t.label}>A short look back</Text>
                <Text className={`${t.heading} mt-1`}>Your {view.month.label.split(' ')[0]} story</Text>
              </View>
              <Text className={`text-[13px] font-semibold ${ink.accent}`}>Play ›</Text>
            </View>
          </MoneyCard>
        )}

        <SectionHeader title="Last six months" />
        <MoneyCard>
          <CashFlow flow={view.flow} months={view.months} shown={view.month.key} onPick={onMonthChange} />
        </MoneyCard>

        <SectionHeader title={isExpense ? 'Spending by day' : 'Money in by day'} />
        <MoneyCard>
          {view.daily.some((d) => d.amount > 0) ? (
            <DailyBars daily={view.daily} />
          ) : (
            <EmptyState
              icon="📅"
              title={isExpense ? 'No spending this month' : 'Nothing came in this month'}
              body="Days appear here as transactions arrive."
            />
          )}
        </MoneyCard>

        {view.categories.length > 0 && (
          <>
            <SectionHeader title={isExpense ? 'Spending by category' : 'Money in by category'} />
            <View className={`${t.card} py-2`} style={{ paddingHorizontal: 16 }}>
              {view.categories.map((c) => {
                const look = categoryLook(c.name);
                return (
                  <Pressable
                    key={c.name}
                    onPress={() => openCategory(c.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.name}, ${c.percentage} percent. See where it went.`}
                    className="py-2.5"
                  >
                    <View className="flex-row items-center">
                      <CategoryChip name={c.name} size={38} />
                      <View className="ml-3 flex-1">
                        <View className="flex-row items-baseline justify-between">
                          <Text className={`flex-1 pr-2 text-[15px] font-semibold ${ink.primary}`} numberOfLines={1}>
                            {c.name} <Text className={`${t.faint} font-normal`}>{c.percentage}% · {c.count}</Text>
                          </Text>
                          <Amount value={c.amount} size="body" paise={false} />
                        </View>
                        {/* Plain styles: className sizes beside a style object let a bar fill the screen on Android. */}
                        <View style={{ marginTop: 8, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: categoryTint(look, dark) }}>
                          <View style={{ height: 6, borderRadius: 3, width: `${Math.min(100, c.percentage)}%`, backgroundColor: look.ink }} />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <SectionHeader title="Highlights" />
        <MoneyCard>
          <View className="gap-3">
            <View className="flex-row gap-3">
              <Tile
                label="Savings rate"
                value={<Text className={`text-[18px] font-semibold ${ink.primary}`}>{view.savingsRate === undefined ? '—' : `${view.savingsRate}%`}</Text>}
                note="of income kept"
              />
              <Tile label="Average a day" value={<Amount value={view.avgDaily} size="body" paise={false} />} note="spent per day" />
            </View>
            <View className="flex-row gap-3">
              <Tile label="Average payment" value={<Amount value={view.avgTransaction} size="body" paise={false} />} note="per expense" />
              <Tile
                label="Busiest day"
                value={<Text className={`text-[18px] font-semibold ${ink.primary}`}>{view.peakDay ? shortDate(view.peakDay.date) : '—'}</Text>}
                note={view.peakDay ? amount(view.peakDay.amount, { paise: false }) : undefined}
              />
            </View>
          </View>
        </MoneyCard>

        {top && (
          <Pressable onPress={() => openCategory(top.name)} accessibilityRole="button" className={`${t.card} mb-4`}>
            <Text className={t.label}>Top category</Text>
            <View className="mt-3 flex-row items-center">
              <CategoryChip name={top.name} size={44} />
              <View className="ml-3 flex-1">
                <Text className={t.heading}>{top.name}</Text>
                <Text className={t.faint}>{top.percentage}% of {isExpense ? 'spending' : 'money in'}</Text>
              </View>
              <Amount value={top.amount} size="body" paise={false} />
            </View>
          </Pressable>
        )}

        {view.largest && (
          <Pressable onPress={() => onEntryPress?.(view.largest!.id)} accessibilityRole="button" className={`${t.card} mb-4`}>
            <Text className={t.label}>Largest expense</Text>
            <View className="mt-3 flex-row items-center">
              <CategoryChip name={view.largest.category} size={44} />
              <View className="ml-3 flex-1">
                <Text className={t.heading} numberOfLines={1}>{view.largest.name}</Text>
                <Text className={t.faint}>{view.largest.category} · {shortDate(view.largest.date)}</Text>
              </View>
              <Amount value={view.largest.amount} size="body" paise={false} />
            </View>
          </Pressable>
        )}

        {onReportPress && (
          <View className="mb-4">
            <SectionHeader title="Financial reports" />
            <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
              {REPORTS.map((r, i) => (
                <View key={r.kind}>
                  {i > 0 && <View className={t.rule} />}
                  <Pressable
                    onPress={() => onReportPress(r.kind)}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.title}: ${r.description}`}
                    className="flex-row items-center py-3.5"
                  >
                    <View className="flex-1 pr-3">
                      <Text className={`text-[15px] font-semibold ${ink.primary}`}>{r.title}</Text>
                      <Text className={`${t.faint} mt-0.5`}>{r.description}</Text>
                    </View>
                    <Icon name="chevron" size={16} color="#8B8B85" />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text className={`${t.faint} mt-2 leading-4`}>
          Totals count money in and out of your own accounts. Transfers between them and investments never count as spending or income.
          These describe what happened; they never suggest where to put money.
        </Text>
      </View>
      <CategoryFlowSheet
        flow={flow}
        visible={flow !== null}
        onClose={() => setFlow(null)}
        onSeeAll={(name) => {
          setFlow(null);
          onCategoryPress?.(name);
        }}
      />
      <MoneyStory story={story} visible={story !== null} onClose={() => setStory(null)} />
    </ScrollView>
  );
};
