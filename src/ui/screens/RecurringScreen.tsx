import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { Paise, toPlainRupees, tryRupeeString } from '@/money/money';
import type { BillDraft } from '@/bills/billText';
import { shortDate, isoDate } from '@/lib/date';
import { t, ink } from '../theme';
import { TAB_BAR_SPACE } from '../kit';
import { Field, ChipRow, ErrorText, PrimaryButton, GhostButton, Label } from '../components';
import { Amount, BottomSheet, EmptyState, ScreenHeader, SectionHeader } from '../parts';
import type { Outcome } from '../store';

export type RecurringCadence = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';

export type RecurringListItem = {
  id: string;
  name: string;
  amount: Paise;
  cadence: RecurringCadence;
  nextDue: string;
  note?: string;
};

export interface RecurringScreenProps {
  items: RecurringListItem[];
  onAdd: (name: string, amount: Paise, cadence: RecurringCadence, nextDue: string, note?: string) => Outcome;
  onMarkPaid: (id: string) => Outcome;
  onDelete: (id: string) => void;
  /** A bill shared as text: opens the add form filled in with what was read, for the user to check. */
  draft?: BillDraft;
}

const CADENCES: RecurringCadence[] = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];
const CADENCE_LABEL: Record<RecurringCadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  'half-yearly': 'Every 6 months',
  yearly: 'Yearly',
};

/** Red once due, amber inside a week, otherwise the ordinary faint tone. */
const dueTone = (nextDue: string, today: string): string => {
  if (nextDue <= today) return ink.negative;
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);
  return nextDue <= isoDate(soon) ? ink.warning : ink.tertiary;
};

const Row: React.FC<{ item: RecurringListItem; today: string; onPress: () => void }> = ({ item, today, onPress }) => (
  <Pressable onPress={onPress} accessibilityRole="button" className="flex-row items-center py-3.5">
    <View className="flex-1 pr-4">
      <Text className={`text-[15px] font-semibold ${ink.primary}`}>{item.name}</Text>
      <Text className={`mt-0.5 text-[12px] ${dueTone(item.nextDue, today)}`}>
        {item.nextDue < today ? 'Overdue since' : 'Due'} {shortDate(item.nextDue)} · {CADENCE_LABEL[item.cadence]}
      </Text>
    </View>
    <Amount value={item.amount} size="body" />
  </Pressable>
);

export const RecurringScreen: React.FC<RecurringScreenProps> = ({ items, onAdd, onMarkPaid, onDelete, draft }) => {
  const today = isoDate(new Date());
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<RecurringListItem | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<RecurringCadence>('monthly');
  const [nextDue, setNextDue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  const openAdd = () => {
    setName('');
    setAmount('');
    setCadence('monthly');
    setNextDue('');
    setNote('');
    setError(undefined);
    setAdding(true);
  };

  useEffect(() => {
    if (!draft) return;
    setName(draft.biller ?? '');
    setAmount(draft.amount === null ? '' : toPlainRupees(draft.amount));
    setCadence('monthly');
    setNextDue(draft.dueDate ?? '');
    setNote(draft.note);
    setError(undefined);
    setAdding(true);
  }, [draft]);

  const submitAdd = () => {
    const paise = tryRupeeString(amount);
    if (paise === null || paise <= 0) return setError('Enter an amount above zero');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue.trim())) return setError('Enter the next due date as YYYY-MM-DD');
    const failed = onAdd(name.trim(), paise, cadence, nextDue.trim(), note.trim() || undefined);
    if (failed) return setError(failed);
    setAdding(false);
  };

  const confirmDelete = (item: RecurringListItem) => {
    Alert.alert('Remove this reminder?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { onDelete(item.id); setSelected(null); } },
    ]);
  };

  const upcoming = [...items].sort((x, y) => (x.nextDue < y.nextDue ? -1 : x.nextDue > y.nextDue ? 1 : 0));

  return (
    <View className={t.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Recurring"
          subtitle="Reminders you set by hand, for bills that repeat too rarely for Hisaab to notice on its own, like a yearly premium."
        />

        <View className={t.page}>
          {items.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title="No reminders yet"
              body="Add rent, insurance or any bill you pay on a schedule, and it will be here when it is due."
            />
          ) : (
            <>
              <SectionHeader title="Upcoming" />
              <View className={`${t.card} py-1`} style={{ paddingHorizontal: 16 }}>
                {upcoming.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 && <View className={t.rule} />}
                    <Row item={item} today={today} onPress={() => setSelected(item)} />
                  </View>
                ))}
              </View>
            </>
          )}

          <View className="pt-6">
            <PrimaryButton label="Add a reminder" onPress={openAdd} />
          </View>
        </View>
      </ScrollView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="New reminder">
        <View className="gap-3">
          <Field label="What is it for" value={name} onChangeText={setName} placeholder="e.g. LIC premium" />
          <Field label="Amount" value={amount} onChangeText={setAmount} prefix="₹" placeholder="0" numeric />
          <View>
            <Label>How often</Label>
            <ChipRow options={CADENCES} value={cadence} onChange={setCadence} labelFor={(c) => CADENCE_LABEL[c]} />
          </View>
          <Field label="Next due" value={nextDue} onChangeText={setNextDue} placeholder="YYYY-MM-DD" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Policy number" />
        </View>
        <ErrorText message={error} />
        <View className="gap-3 pt-5">
          <PrimaryButton label="Add" onPress={submitAdd} />
          <Pressable onPress={() => setAdding(false)} className="py-2">
            <Text className={`${t.muted} text-center`}>Cancel</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet visible={selected !== null} onClose={() => setSelected(null)} title={selected?.name}>
        {selected && (
          <>
            <Text className={`${t.muted} -mt-2`}>
              Due {shortDate(selected.nextDue)} · {CADENCE_LABEL[selected.cadence]}
            </Text>
            <View className="mt-2">
              <Amount value={selected.amount} size="figure" />
            </View>
            {selected.note && <Text className={`${t.faint} mt-2`}>{selected.note}</Text>}
            <View className="gap-3 pt-6">
              <PrimaryButton label="Mark as paid" onPress={() => { onMarkPaid(selected.id); setSelected(null); }} />
              <GhostButton label="Remove reminder" onPress={() => confirmDelete(selected)} />
              <Pressable onPress={() => setSelected(null)} className="py-2">
                <Text className={`${t.muted} text-center`}>Close</Text>
              </Pressable>
            </View>
          </>
        )}
      </BottomSheet>
    </View>
  );
};
