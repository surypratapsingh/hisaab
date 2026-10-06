import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import type { MessageKind } from '@/capture/sort';
import type { MessagesView } from '@/capture/messages';
import { t } from '../theme';
import { maskAmountsInMessage } from '@/lib/amountsInText';
import { MASK } from '../kit';
import { useLedger } from '../store';

export interface MessagesScreenProps {
  view: MessagesView;
  /** Shown until the SMS history has been read once. */
  onReadHistory?: () => void;
  readingHistory?: boolean;
}

const LABELS: Record<MessageKind, string> = {
  transaction: 'Payments',
  mandate: 'Autopay',
  scam: 'Scams',
  offer: 'Offers',
  otp: 'OTPs',
  reminder: 'Reminders',
  info: 'Other',
};

// Background on the pill, colour on its text: Android ignores a background
// and rounding set on a Text inside a row.
const TAGS: Record<MessageKind, [pill: string, text: string]> = {
  transaction: ['bg-emerald-50 dark:bg-emerald-950', 'text-emerald-700 dark:text-emerald-300'],
  mandate: ['bg-blue-50 dark:bg-blue-950', 'text-blue-700 dark:text-blue-300'],
  scam: ['bg-red-50 dark:bg-red-950', 'text-red-700 dark:text-red-300'],
  offer: ['bg-amber-50 dark:bg-amber-950', 'text-warning dark:text-warning-dark'],
  otp: ['bg-surfaceMuted dark:bg-surfaceMuted-dark', 'text-textSecondary dark:text-textSecondary-dark'],
  reminder: ['bg-violet-50', 'text-violet-700'],
  info: ['bg-surfaceMuted dark:bg-surfaceMuted-dark', 'text-textSecondary dark:text-textSecondary-dark'],
};

const ORDER: MessageKind[] = ['transaction', 'mandate', 'scam', 'reminder', 'offer', 'otp', 'info'];

/** "26 Sep, 9:05 am" in the phone's own time zone. */
const when = (iso: string): string => {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = d.getHours() % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]}, ${hours}:${minutes} ${d.getHours() < 12 ? 'am' : 'pm'}`;
};

/**
 * Every bank and UPI message the app has seen, sorted on the phone into
 * payments, autopays, scams and the rest, each with the reason.
 */
export const MessagesScreen: React.FC<MessagesScreenProps> = ({ view, onReadHistory, readingHistory }) => {
  const hidden = useLedger((state) => state.hideAmounts);
  const [filter, setFilter] = useState<MessageKind | 'all'>('all');
  const rows = filter === 'all' ? view.rows : view.rows.filter((r) => r.kind === filter);

  return (
    <ScrollView className={t.screen} contentContainerClassName="pb-12">
      <View className={t.page}>
        <View className="pt-8 pb-4">
          <Text className={t.label}>Messages</Text>
          <Text className={`${t.muted} mt-2`}>
            Sorted on this phone. Only payments reach your accounts; scams are flagged, never acted on.
          </Text>
        </View>

        {onReadHistory && (
          <Pressable onPress={onReadHistory} disabled={readingHistory} className={`${t.card} mb-4`}>
            <Text className={t.heading}>{readingHistory ? 'Reading your SMS…' : 'Read my SMS history'}</Text>
            <Text className={`${t.muted} mt-1`}>
              Go through past bank and UPI messages once, to record payments from before the app was
              installed.
            </Text>
          </Pressable>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5 mb-2" contentContainerClassName="gap-2 px-5">
          {(['all', ...ORDER] as const).map((kind) => {
            const count = kind === 'all' ? view.rows.length : view.counts[kind];
            if (kind !== 'all' && count === 0) return null;
            const chosen = filter === kind;
            return (
              <Pressable
                key={kind}
                onPress={() => setFilter(kind)}
                className={`rounded-full px-4 py-2 ${chosen ? 'bg-textPrimary dark:bg-textPrimary-dark' : 'bg-surfaceMuted dark:bg-surfaceMuted-dark'}`}
              >
                <Text className={`text-[13px] font-medium ${chosen ? 'text-background dark:text-background-dark' : 'text-textSecondary dark:text-textSecondary-dark'}`}>
                  {kind === 'all' ? 'All' : LABELS[kind]} {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {rows.length === 0 && (
          <Text className={`${t.muted} pt-6`}>
            Nothing yet. Messages appear here as they arrive, once notification access is on.
          </Text>
        )}

        {rows.map((row) => (
          <View key={row.id} className="border-b border-border dark:border-border-dark py-4">
            <View className="flex-row items-center justify-between">
              <Text className="mr-3 flex-1 text-[13px] font-semibold text-textPrimary dark:text-textPrimary-dark" numberOfLines={1}>
                {row.from}
              </Text>
              <Text className={t.faint} numberOfLines={1}>
                {when(row.at)}
              </Text>
            </View>
            <Text className={`${t.body} mt-1`} numberOfLines={3}>
              {hidden ? maskAmountsInMessage(row.text, MASK) : row.text}
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <View className={`rounded-full px-2 py-0.5 ${TAGS[row.kind][0]}`}>
                <Text className={`text-[11px] font-medium ${TAGS[row.kind][1]}`}>{LABELS[row.kind]}</Text>
              </View>
              <Text className={t.faint}>{row.reason}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};
