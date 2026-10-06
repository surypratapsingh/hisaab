import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable } from 'react-native';
import { Paise } from '@/money/money';
import type { SearchResult } from '@/repo/search';
import { t, bg, ink, line } from '../theme';
import { TAB_BAR_SPACE, TxRow, useAmount, useInk, Icon } from '../kit';
import { ACTIVITY_FILTERS as FILTERS, fitsFilter, type ActivityFilter as Filter } from '@/lib/activityFilter';
import { Amount, MoneyCard, ScreenHeader, SegmentedControl, EmptyState } from '../parts';

export type TimelineRow = {
  id: string;
  merchant: string;
  category: string;
  amount: Paise;
  /** What kind of entry the ledger holds: expense, income, transfer or investment. */
  kind?: string;
};

export type TimelineEntry = {
  date: string;
  dayTotal: Paise;
  entries: TimelineRow[];
};

export interface TimelineScreenProps {
  entries: TimelineEntry[];
  onEntryPress?: (entryId: string) => void;
  /** Opens with this already typed into the search box. */
  initialQuery?: string;
  /** Looks through the whole ledger; without it, search only covers the entries shown. */
  onSearch?: (query: string) => SearchResult;
  /** Saves what is listed (everything, or what the search matches) as a CSV file. */
  onExport?: (query: string) => void;
  /** Defaults to "Activity"; another title when listing a set such as one statement import. */
  title?: string;
  subtitle?: string;
  /** Money in and out across the entries listed, shown above them when not searching. */
  summary?: SearchResult;
}

/** Money in, money out and what is left, across everything a search matched. */
const Totals: React.FC<{ result: SearchResult }> = ({ result }) => {
  const amount = useAmount();
  const column = (label: string, value: Paise, tone: 'positive' | 'negative' | 'auto') => (
    <View className="flex-1">
      <Amount value={value} size="body" tone={tone} paise={false} fit />
      <Text className={`${t.faint} mt-0.5`}>{label}</Text>
    </View>
  );
  return (
    <View className="px-5 pb-2">
      <MoneyCard gap={4}>
        <View className="flex-row gap-3">
          {column('income', result.income, 'positive')}
          {column('expense', result.expense, 'negative')}
          {column('net', result.net, 'auto')}
        </View>
        <Text className={`${t.faint} mt-3`}>
          {result.count} transaction{result.count === 1 ? '' : 's'}
          {result.truncated ? ' · showing the newest ones' : ''}
        </Text>
        {result.moved > 0 && (
          <Text className={`${t.faint} mt-1`}>
            {amount(result.moved, { paise: false })} moved to your own accounts or investments, not counted as expense
          </Text>
        )}
      </MoneyCard>
    </View>
  );
};

export const TimelineScreen: React.FC<TimelineScreenProps> = ({
  entries,
  onEntryPress,
  initialQuery,
  onSearch,
  onExport,
  title = 'Activity',
  subtitle,
  summary,
}) => {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [filter, setFilter] = useState<Filter>('All');
  const { colors } = useInk();
  const amount = useAmount();

  // Searched in the database, so entries older than the page shown are found too. It reads
  // again when the entries change; the callback itself is not a dependency on purpose.
  const found = useMemo(
    () => (query.trim() && onSearch ? onSearch(query) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, entries]
  );

  const visible = useMemo(() => {
    let days: TimelineEntry[];
    if (found) {
      days = found.days;
    } else {
      const needle = query.trim().toLowerCase();
      days = !needle
        ? entries
        : entries.map((day) => ({
            ...day,
            entries: day.entries.filter(
              (row) => row.merchant.toLowerCase().includes(needle) || row.category.toLowerCase().includes(needle)
            ),
          }));
    }
    if (filter === 'All') return days.filter((day) => day.entries.length > 0);
    return days
      .map((day) => ({ ...day, entries: day.entries.filter((row) => fitsFilter(row, filter)) }))
      .filter((day) => day.entries.length > 0);
  }, [entries, query, found, filter]);

  const searching = query.trim().length > 0;

  return (
    <View className={t.screen}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        right={
          onExport ? (
            <Pressable
              onPress={() => onExport(query)}
              accessibilityRole="button"
              accessibilityLabel={searching ? 'Export these transactions as CSV' : 'Export all transactions as CSV'}
              hitSlop={8}
              className={`rounded-full border ${line.border} ${bg.surface} px-4 py-2`}
            >
              <Text className={`text-[13px] font-semibold ${ink.primary}`}>CSV</Text>
            </Pressable>
          ) : undefined
        }
      />

      <View className="px-5 pb-3">
        <View className={`flex-row items-center rounded-2xl border ${line.border} ${bg.surface} px-3.5`}>
          <Icon name="search" size={20} color={colors.textTertiary} />
          <TextInput
            placeholder="Search transactions"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            className={`ml-2 flex-1 py-3.5 text-[15px] ${ink.primary}`}
          />
          {searching && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Icon name="close" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      <View className="px-5 pb-3">
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      {found && found.count > 0 && <Totals result={found} />}
      {!searching && summary && summary.count > 0 && <Totals result={summary} />}

      {/* A list, not a scroll view: drawing all 200 rows at once took two seconds on the phone. */}
      <FlatList
        data={visible}
        keyExtractor={(day) => day.date}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          searching || filter !== 'All' ? (
            <EmptyState
              icon="🔍"
              title={searching ? `Nothing matches “${query.trim()}”` : `No ${filter.toLowerCase()} to show`}
              body={
                searching
                  ? 'Try a merchant name, a category or an exact amount.'
                  : 'Nothing in your recent activity fits this filter.'
              }
              action={{
                label: searching ? 'Clear search' : 'Show everything',
                onPress: () => {
                  setQuery('');
                  setFilter('All');
                },
              }}
            />
          ) : (
            <EmptyState
              icon="🧾"
              title="No transactions yet"
              body="Import a bank statement, let Hisaab read bank messages, or tap + to add one yourself."
            />
          )
        }
        renderItem={({ item: day }) => (
          <View className="px-5 pt-4">
            <View className="flex-row items-baseline justify-between pb-1">
              {/* No letter spacing on dates: Android mis-measures spaced text and
                  wrapped "01/02/2026" onto two lines. */}
              <Text className={`text-[13px] font-semibold ${ink.secondary}`} numberOfLines={1}>
                {day.date}
              </Text>
              <Text className={t.faint}>{amount(day.dayTotal)}</Text>
            </View>

            <View className={`rounded-3xl border ${line.border} ${bg.surface} px-4`}>
              {day.entries.map((row, index) => (
                <View key={row.id}>
                  {index > 0 && <View className={`${t.rule} ml-14`} />}
                  <TxRow
                    title={row.merchant}
                    category={row.category}
                    amount={row.amount}
                    onPress={() => onEntryPress?.(row.id)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
      />
    </View>
  );
};
