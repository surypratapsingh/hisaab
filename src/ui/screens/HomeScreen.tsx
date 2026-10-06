import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Paise, isNegative, percentChange } from '@/money/money';
import { shortDate } from '@/lib/date';
import { amountsInText } from '@/lib/amountsInText';
import type { InsightKind } from '@/analysis/insights';
import { t, ink } from '../theme';
import { useAmount, useInk, TAB_BAR_SPACE, TxRow, CategoryChip, categoryLook, categoryTint, Icon } from '../kit';
import { Amount, MoneyCard, InsightCard, SectionHeader, SmallButton } from '../parts';
import { INSIGHT_LOOK } from '../insightLook';
import { useAnchor } from '../motion/anchors';
import { SafeBattery } from '../motion/SafeBattery';

import { MandateCard } from '../MandateCard';
import { PaymentCard } from '../PaymentCard';
import { SpendCalendar } from '../SpendCalendar';
import { SpendingScoreCard } from '../SpendingScoreCard';
import type { SpendingScore } from '@/analysis/spendingScore';
import type { TrackedMandate } from '@/capture/mandates';
import type { PaySession } from '@/upi/session';
import type { WaitingAccount } from '@/capture/ingest';
import type { MaybeTwice } from '@/repo/doubles';

export type MonthSummary = {
  spent: Paise;
  received: Paise;
  net: Paise;
};

export type TopCategory = {
  name: string;
  amount: Paise;
  percentage: number;
};

export type RecentEntry = {
  id: string;
  merchant: string;
  category: string;
  amount: Paise;
  date: string;
};

export interface HomeScreenProps {
  month: string;
  summary: MonthSummary;
  /** Same three figures for the month before, so Home can show the change. */
  lastMonth?: MonthSummary;
  /** What went out on each day of this month, the 1st first — drawn as a calendar. */
  spendByDay?: Paise[];
  /** This month's days against the daily average from before it. */
  spendingScore?: SpendingScore | null;
  topCategories: TopCategory[];
  recentEntries: RecentEntry[];
  reviewCount: number;
  suspenseRatio?: number;
  onReviewPress?: () => void;
  onCategoryPress?: (category: string) => void;
  onEntryPress?: (entryId: string) => void;
  onSeeAllPress?: () => void;
  /** The figure, the payday it runs to, and what the app knows about the days between. */
  safeToSpend?:
    | { amount: Paise; until: string; days: number; usualDaily?: Paise; liquid?: Paise }
    | 'needs_payday';
  onSafeToSpendPress?: () => void;
  /** The one thing that changed most, in the insight's own words. */
  change?: { kind: InsightKind; sentence: string; onPress: () => void };
  /** Bank messages about accounts that have not been added, whose money is not counted. */
  waiting?: { accounts: WaitingAccount[]; onAdd: () => void };
  /** Asks for a backup; given only when one is due. */
  backup?: { sentence: string; onOpen: () => void; onLater: () => void };
  /** Shown until notification access is on, so payments are caught automatically. */
  capture?: { onEnable: () => void };
  /** Payments handed to a UPI app that the bank's message has not settled yet. */
  payments?: {
    items: PaySession[];
    accounts: Array<{ id: string; name: string }>;
    onPaid: (id: string, accountId: string) => void;
    onNotPaid: (id: string) => void;
  };
  /** Autopays waiting for a yes. */
  mandates?: TrackedMandate[];
  onConfirmMandate?: (key: string, details?: { name?: string; purpose?: string }) => void;
  onDismissMandate?: (key: string) => void;
  onMessagesPress?: () => void;
  onBudgetsPress?: () => void;
  budgetsOverCount?: number;
  onRecurringPress?: () => void;
  recurringDueCount?: number;
  /** The wealth summary shown at the very top. */
  hero?: React.ReactNode;
  scamCount?: number;
  /** A bank payment and a typed entry that may be one payment counted twice; the first of `count`. */
  twice?: { pair: MaybeTwice; count: number; onSame: () => void; onTwo: () => void };
  /** Cash taken out and not yet accounted for. */
  cash?: { unexplained: Paise; onExplain: () => void; onKeep: () => void };
}

/** Something that needs a look or an answer: a title, a line of why, and up to two buttons. */
const Notice: React.FC<{
  title: string;
  body?: string;
  primary?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  onPress?: () => void;
  children?: React.ReactNode;
}> = ({ title, body, primary, secondary, onPress, children }) => (
  <MoneyCard onPress={onPress} gap={12}>
    <View className="flex-row items-center">
      <View className="flex-1">
        <Text className={t.heading}>{title}</Text>
        {body ? <Text className={`${t.muted} mt-1 leading-5`}>{body}</Text> : null}
      </View>
      {onPress ? <Icon name="chevron" size={16} color="#8B8B85" /> : null}
    </View>
    {children}
    {(primary || secondary) && (
      <View className="mt-4 flex-row gap-3">
        {primary && <SmallButton label={primary.label} onPress={primary.onPress} />}
        {secondary && <SmallButton label={secondary.label} onPress={secondary.onPress} outline />}
      </View>
    )}
  </MoneyCard>
);

/** A category's share of the month: its chip, amount, and a bar in its colour. */
const CategoryBar: React.FC<{ category: TopCategory; onPress?: () => void }> = ({ category, onPress }) => {
  const look = categoryLook(category.name);
  const { dark } = useInk();
  const anchor = useAnchor(`category:${category.name}`);
  return (
    <Pressable ref={anchor} collapsable={false} onPress={onPress} className="flex-row items-center py-2.5">
      <CategoryChip name={category.name} size={38} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-baseline justify-between">
          <Text className={`text-[15px] font-semibold ${ink.primary}`}>{category.name}</Text>
          <Amount value={category.amount} size="body" />
        </View>
        {/* Plain styles: mixing className sizes with a style object let the
            bar grow to fill the screen on Android. */}
        <View style={{ marginTop: 8, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: categoryTint(look, dark) }}>
          <View style={{ height: 6, borderRadius: 3, width: `${Math.min(100, category.percentage)}%`, backgroundColor: look.ink }} />
        </View>
      </View>
    </Pressable>
  );
};

/** What went out and came in so far this month, against the same days of last month. */
const MonthCard: React.FC<{ month: string; summary: MonthSummary; lastMonth?: MonthSummary; today?: Paise }> = ({
  month,
  summary,
  lastMonth,
  today,
}) => {
  const amount = useAmount();
  const spentAnchor = useAnchor('spent');
  const spentChange = lastMonth && percentChange(summary.spent, lastMonth.spent);
  const receivedChange = lastMonth && percentChange(summary.received, lastMonth.received);

  const column = (label: string, value: Paise, tone: 'neutral' | 'positive', change: number | undefined, goodIsUp: boolean) => (
    <View className="flex-1" ref={label === 'Spent' ? spentAnchor : undefined} collapsable={false}>
      <Text className={t.faint}>{label}</Text>
      <View className="mt-1">
        <Amount value={value} size="figure" tone={tone} paise={false} fit animate />
      </View>
      {change !== undefined && (
        <Text className={`mt-1 text-[12px] font-semibold ${(change >= 0) === goodIsUp ? ink.positive : ink.negative}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
        </Text>
      )}
    </View>
  );

  return (
    <MoneyCard>
      <View className="flex-row items-center justify-between">
        <Text className={t.label}>This month</Text>
        <Text className={t.faint}>{month}</Text>
      </View>
      <View className="mt-3 flex-row gap-3">
        {column('Spent', summary.spent, 'neutral', spentChange, false)}
        {column('Received', summary.received, 'positive', receivedChange, true)}
      </View>
      <View className="mt-3 gap-0.5">
        {(spentChange !== undefined || receivedChange !== undefined) && (
          <Text className={t.faint}>Against the same days last month</Text>
        )}
        {today !== undefined && (
          <Text className={t.faint}>Today {today > 0 ? amount(today, { paise: false }) : 'nothing yet'}</Text>
        )}
      </View>
    </MoneyCard>
  );
};

/** Until the next salary: what is free, when that is, and what usual spending is. */
const SafeCard: React.FC<{
  safe: Exclude<HomeScreenProps['safeToSpend'], undefined>;
  onPress?: () => void;
}> = ({ safe, onPress }) => {
  const amount = useAmount();
  if (safe === 'needs_payday') {
    return (
      <MoneyCard onPress={onPress}>
        <View className="flex-row items-center">
          <View className="flex-1">
            <Text className={t.label}>Safe to spend</Text>
            <Text className={`${t.heading} mt-2`}>Tell Hisaab when you are paid</Text>
            <Text className={`${t.muted} mt-1`}>Then it can show what is free until then.</Text>
          </View>
          <Icon name="chevron" size={16} color="#8B8B85" />
        </View>
      </MoneyCard>
    );
  }
  const over = isNegative(safe.amount);
  return (
    <MoneyCard onPress={onPress} accessibilityLabel="Safe to spend. Open the breakdown.">
      <View className="flex-row items-start justify-between">
        <Text className={t.label}>Safe to spend</Text>
        <Icon name="chevron" size={16} color="#8B8B85" />
      </View>
      <View className="mt-2">
        <Amount value={safe.amount} size="display" tone={over ? 'negative' : 'neutral'} animate />
      </View>
      <Text className={`${t.muted} mt-1`}>{over ? 'More is spoken for than you have before payday' : 'until your next salary'}</Text>
      {safe.liquid !== undefined && (
        <View className="mt-4">
          <SafeBattery free={safe.amount} liquid={safe.liquid} compact />
        </View>
      )}
      <View className={`${t.rule} my-4`} />
      <View className="flex-row">
        <View className="flex-1">
          <Text className={t.faint}>Next salary</Text>
          <Text className={`mt-1 text-[15px] font-semibold ${ink.primary}`}>
            {shortDate(safe.until)} · {safe.days === 1 ? '1 day' : `${safe.days} days`}
          </Text>
        </View>
        {safe.usualDaily !== undefined && (
          <View className="flex-1">
            <Text className={t.faint}>Usual spending</Text>
            <Text className={`mt-1 text-[15px] font-semibold ${ink.primary}`}>{amount(safe.usualDaily, { paise: false })} a day</Text>
          </View>
        )}
      </View>
    </MoneyCard>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  month,
  summary,
  lastMonth,
  spendByDay,
  spendingScore,
  topCategories,
  recentEntries,
  reviewCount,
  suspenseRatio,
  onReviewPress,
  onCategoryPress,
  onEntryPress,
  onSeeAllPress,
  safeToSpend,
  onSafeToSpendPress,
  change,
  capture,
  backup,
  waiting,
  twice,
  cash,
  payments,
  mandates,
  onConfirmMandate,
  onDismissMandate,
  onMessagesPress,
  scamCount,
  onBudgetsPress,
  budgetsOverCount,
  onRecurringPress,
  recurringDueCount,
  hero,
}) => {
  const amount = useAmount();

  // Recent entries arrive newest first, each carrying its own day label.
  const days: Array<{ label: string; rows: RecentEntry[] }> = [];
  for (const entry of recentEntries) {
    const last = days[days.length - 1];
    if (last && last.label === entry.date) last.rows.push(entry);
    else days.push({ label: entry.date, rows: [entry] });
  }

  const [showAllAttention, setShowAllAttention] = useState(false);
  const { colors } = useInk();
  const recentAnchor = useAnchor('recent');

  /** Everything that wants a look, most useful first; shown together so Home stays calm. */
  const attention: Array<{ key: string; title: string; body?: string; onPress?: () => void; later?: () => void }> = [];
  if (reviewCount > 0) {
    attention.push({
      key: 'review',
      title: `${reviewCount} ${reviewCount === 1 ? 'transaction needs' : 'transactions need'} a category`,
      body: 'Clearing these teaches Hisaab your merchants.',
      onPress: onReviewPress,
    });
  }
  if (budgetsOverCount) {
    attention.push({
      key: 'budgets',
      title: `${budgetsOverCount} ${budgetsOverCount === 1 ? 'budget is' : 'budgets are'} over the limit`,
      onPress: onBudgetsPress,
    });
  }
  if (recurringDueCount) {
    attention.push({
      key: 'recurring',
      title: `${recurringDueCount} ${recurringDueCount === 1 ? 'payment' : 'payments'} due this week`,
      onPress: onRecurringPress,
    });
  }
  if (waiting && waiting.accounts.length > 0) {
    const digits = waiting.accounts.slice(0, 3).map((a) => `••${a.digits}`).join(', ');
    const more = waiting.accounts.length - 3;
    attention.push({
      key: 'waiting',
      title: 'Bank messages for accounts you have not added',
      body: `${digits}${more > 0 ? ` and ${more} more` : ''}. Until you add them, that money is not counted.`,
      onPress: waiting.onAdd,
    });
  }
  if (scamCount) {
    attention.push({
      key: 'scams',
      title: `${scamCount} ${scamCount === 1 ? 'message' : 'messages'} flagged as scams`,
      body: 'Not counted. Nothing was opened or replied to.',
      onPress: onMessagesPress,
    });
  }
  if (capture) {
    attention.push({
      key: 'capture',
      title: 'Catch payments automatically',
      body: 'Let Hisaab read bank and UPI notifications. They stay on this phone.',
      onPress: capture.onEnable,
    });
  }
  if (backup) {
    attention.push({
      key: 'backup',
      title: 'Back up your data',
      body: `Everything lives only on this phone. ${backup.sentence}`,
      onPress: backup.onOpen,
      later: backup.onLater,
    });
  }

  return (
    // No background of its own: the faint mood the app draws behind Home shows through.
    <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      {hero}
      <View className={`${t.page} pt-6`}>
        {payments?.items.map((p) => (
          <PaymentCard
            key={p.id}
            payment={p}
            accounts={payments.accounts}
            onPaid={(accountId) => payments.onPaid(p.id, accountId)}
            onNotPaid={() => payments.onNotPaid(p.id)}
          />
        ))}

        {safeToSpend && <SafeCard safe={safeToSpend} onPress={onSafeToSpendPress} />}

        <MonthCard month={month} summary={summary} lastMonth={lastMonth} today={spendByDay?.[new Date().getDate() - 1]} />

        {change && (
          <InsightCard
            eyebrow={`What changed · ${INSIGHT_LOOK[change.kind].eyebrow}`}
            icon={INSIGHT_LOOK[change.kind].icon}
            headline={amountsInText(change.sentence, amount)}
            action={{ label: 'View why', onPress: change.onPress }}
            gap={16}
          />
        )}

        {mandates?.map((m) => (
          <MandateCard
            key={m.key}
            mandate={m}
            onConfirm={(details) => onConfirmMandate?.(m.key, details)}
            onDismiss={() => onDismissMandate?.(m.key)}
          />
        ))}

        {cash && (
          <Notice
            title="Cash from the ATM"
            body={`${amount(cash.unexplained)} taken out. Where did it go?`}
            primary={{ label: 'Add what I spent', onPress: cash.onExplain }}
            secondary={{ label: 'I still have it', onPress: cash.onKeep }}
          />
        )}

        {twice && (
          <Notice
            title="Counted twice?"
            body={`${twice.pair.bank.account} paid ${amount(twice.pair.amount)} on ${shortDate(twice.pair.bank.date)} ("${twice.pair.bank.description}"). You typed "${twice.pair.typed.description}" for the same amount on ${shortDate(twice.pair.typed.date)}, from ${twice.pair.typed.account}.${twice.count > 1 ? ` ${twice.count - 1} more to check.` : ''}`}
            primary={{ label: 'Same payment', onPress: twice.onSame }}
            secondary={{ label: 'Two payments', onPress: twice.onTwo }}
          />
        )}

        {attention.length > 0 && (
          <View className="pb-4">
            <SectionHeader title="Needs attention" />
            <View className={`${t.card} py-1`} style={{ paddingHorizontal: 0 }}>
              {attention.slice(0, showAllAttention ? attention.length : 3).map((row, index) => (
                <View key={row.key}>
                  {index > 0 && <View className={`${t.rule} mx-5`} />}
                  <Pressable onPress={row.onPress} accessibilityRole="button" className="flex-row items-center px-5 py-3.5">
                    <View className="flex-1 pr-3">
                      <Text className={`text-[15px] font-semibold ${ink.primary}`}>{row.title}</Text>
                      {row.body ? <Text className={`${t.faint} mt-0.5 leading-4`}>{row.body}</Text> : null}
                    </View>
                    {row.later ? (
                      <Pressable onPress={row.later} hitSlop={8} className="mr-2">
                        <Text className={`text-[13px] ${ink.tertiary}`}>Later</Text>
                      </Pressable>
                    ) : null}
                    <Icon name="chevron" size={16} color={colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
              {attention.length > 3 && (
                <Pressable onPress={() => setShowAllAttention(!showAllAttention)} className="items-center py-3">
                  <Text className={`text-[13px] font-medium ${ink.accent}`}>
                    {showAllAttention ? 'Show fewer' : `Show ${attention.length - 3} more`}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <View className="pt-2">
          <SectionHeader title="Recent" action={onSeeAllPress ? { label: 'See all', onPress: onSeeAllPress } : undefined} />
          <View ref={recentAnchor} collapsable={false} className={`${t.card} py-2`} style={{ paddingHorizontal: 16 }}>
            {days.length === 0 ? (
              <Text className={`${t.muted} py-6 text-center`}>
                Transactions appear here as bank messages arrive or you add them.
              </Text>
            ) : (
              days.map((day, i) => (
                <View key={`${day.label}-${i}`}>
                  <Text className={`${t.faint} pb-0.5 pt-3`}>{day.label}</Text>
                  {day.rows.map((entry) => (
                    <TxRow
                      key={entry.id}
                      title={entry.merchant}
                      category={entry.category}
                      amount={entry.amount}
                      onPress={() => onEntryPress?.(entry.id)}
                    />
                  ))}
                </View>
              ))
            )}
          </View>
        </View>

        {spendingScore && (
          <View className="pt-6">
            <SectionHeader title="Spending score" />
            <SpendingScoreCard score={spendingScore} monthName={month.split(' ')[0]} />
          </View>
        )}

        {spendByDay && spendByDay.some((d) => d > 0) && (
          <View className="pt-6">
            <SectionHeader title="Day by day" />
            <Text className={`${t.muted} -mt-1 mb-3`}>Darker days are where more went out.</Text>
            <View className={`${t.card} py-4`} style={{ paddingHorizontal: 12 }}>
              <SpendCalendar days={spendByDay} today={new Date()} />
            </View>
          </View>
        )}

        {topCategories.length > 0 && (
          <View className="pt-6">
            <SectionHeader title="Where it went" />
            <View className={`${t.card} py-2`} style={{ paddingHorizontal: 16 }}>
              {topCategories.map((cat) => (
                <CategoryBar key={cat.name} category={cat} onPress={() => onCategoryPress?.(cat.name)} />
              ))}
            </View>
          </View>
        )}

        {suspenseRatio !== undefined && (
          <Text className={`${t.faint} pb-2 pt-8`}>
            {(suspenseRatio * 100).toFixed(1)}% of flow still unexplained
          </Text>
        )}
      </View>
    </ScrollView>
  );
};
