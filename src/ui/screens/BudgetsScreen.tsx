import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Switch } from 'react-native';
import { Paise, abs, tryRupeeString } from '@/money/money';
import { t, ink } from '../theme';
import { useAmount, TAB_BAR_SPACE, CategoryChip } from '../kit';
import { Field, ChipRow, ErrorText, PrimaryButton, GhostButton, Label } from '../components';
import { Amount, BottomSheet, EmptyState, MoneyCard, ProgressBar, ScreenHeader } from '../parts';
import type { Outcome } from '../store';

export type BudgetItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: Paise;
  spent: Paise;
  remaining: Paise;
  percentage: number;
  over: boolean;
  daysLeft: number;
  perDay: Paise;
  pace: number;
  rollover: boolean;
  /** Unspent money carried in from earlier months (part of limit). */
  carried: Paise;
  /** This month's amount plus what was carried in. */
  limit: Paise;
};

export interface BudgetsScreenProps {
  /** Called once when the screen opens. */
  onOpened?: () => void;
  budgets: BudgetItem[];
  /** Categories a new budget can be set on: id and display name. */
  categories: Array<{ id: string; name: string }>;
  onAdd: (categoryId: string, amount: Paise) => Outcome;
  onEdit: (id: string, amount: Paise) => Outcome;
  onDelete: (id: string) => void;
  onRollover: (id: string, on: boolean) => Outcome;
}

/** One category's limit for the month: what is spent, what is left, and where an even pace would be. */
const BudgetCard: React.FC<{ budget: BudgetItem; onPress: () => void }> = ({ budget, onPress }) => {
  const amount = useAmount();

  return (
    <MoneyCard onPress={onPress} anchor={`budget:${budget.id}`} accessibilityLabel={`${budget.categoryName} budget. Open to edit.`}>
      <View className="flex-row items-center">
        <CategoryChip name={budget.categoryName} size={40} />
        <View className="ml-3 flex-1">
          <Text className={t.heading}>{budget.categoryName}</Text>
        </View>
        <Text className={`text-[13px] font-semibold ${budget.over ? ink.negative : ink.secondary}`}>{budget.percentage}%</Text>
      </View>

      <View className="mt-4 flex-row items-baseline">
        <Amount value={budget.spent} size="figure" tone={budget.over ? 'negative' : 'neutral'} paise={false} />
        <Text className={`ml-1.5 text-[14px] ${ink.tertiary}`}>/ {amount(budget.limit, { paise: false })}</Text>
      </View>

      <View className="mt-3">
        {/* Where an even pace through the month would have the bar. */}
        <ProgressBar value={budget.percentage} tone={budget.over ? 'negative' : 'neutral'} marker={budget.pace} />
      </View>

      {budget.over ? (
        <Text className={`mt-2.5 text-[13px] font-medium ${ink.negative}`}>{amount(abs(budget.remaining))} over</Text>
      ) : (
        <Text className={`${t.muted} mt-2.5`}>
          {amount(budget.remaining)} left ·{' '}
          {budget.daysLeft === 1
            ? 'the last day of the month'
            : `${amount(budget.perDay, { paise: false })} a day for ${budget.daysLeft} days`}
        </Text>
      )}
      {budget.carried > 0 && (
        <Text className={`${t.faint} mt-1`}>Includes {amount(budget.carried)} carried over</Text>
      )}
    </MoneyCard>
  );
};

export const BudgetsScreen: React.FC<BudgetsScreenProps> = ({ budgets, categories, onAdd, onEdit, onDelete, onRollover, onOpened }) => {
  useEffect(() => {
    // Let the cards draw first, so anything celebrated has a card to celebrate on.
    const timer = setTimeout(() => onOpened?.(), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<BudgetItem | null>(null);

  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();

  const [editAmount, setEditAmount] = useState('');
  const [editError, setEditError] = useState<string>();
  const [editRollover, setEditRollover] = useState(false);

  const openAdd = () => {
    setCategoryId(categories[0]?.id ?? '');
    setAmount('');
    setError(undefined);
    setAdding(true);
  };

  const submitAdd = () => {
    if (!categoryId) return setError('Choose a category');
    const paise = tryRupeeString(amount);
    if (paise === null || paise <= 0) return setError('Enter a limit above zero');
    const failed = onAdd(categoryId, paise);
    if (failed) return setError(failed);
    setAdding(false);
  };

  const openEdit = (budget: BudgetItem) => {
    setSelected(budget);
    setEditAmount(String(budget.amount / 100));
    setEditRollover(budget.rollover);
    setEditError(undefined);
  };

  const submitEdit = () => {
    if (!selected) return;
    const paise = tryRupeeString(editAmount);
    if (paise === null || paise <= 0) return setEditError('Enter a limit above zero');
    const failed = onEdit(selected.id, paise);
    if (failed) return setEditError(failed);
    setSelected(null);
  };

  const confirmDelete = (budget: BudgetItem) => {
    Alert.alert('Remove this budget?', budget.categoryName, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { onDelete(budget.id); setSelected(null); } },
    ]);
  };

  return (
    <View className={t.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Budgets" subtitle="A limit for one category, month to month." />

        <View className={t.page}>
          {budgets.length === 0 ? (
            <EmptyState
              icon="🎯"
              title="No budgets yet"
              body="Set a monthly limit for a category like Food, and Hisaab shows how much is left and how fast it is going."
            />
          ) : (
            budgets.map((budget) => <BudgetCard key={budget.id} budget={budget} onPress={() => openEdit(budget)} />)
          )}

          <PrimaryButton label="Add a budget" onPress={openAdd} />
        </View>
      </ScrollView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="New budget">
        <View className="gap-3">
          <View>
            <Label>Category</Label>
            <ChipRow
              options={categories.map((c) => c.id)}
              value={categoryId}
              onChange={setCategoryId}
              labelFor={(id) => categories.find((c) => c.id === id)?.name ?? id}
            />
          </View>
          <Field label="Limit, every month" value={amount} onChangeText={setAmount} prefix="₹" placeholder="0" numeric />
        </View>
        <ErrorText message={error} />
        <View className="gap-3 pt-5">
          <PrimaryButton label="Add" onPress={submitAdd} />
          <Pressable onPress={() => setAdding(false)} className="py-2">
            <Text className={`${t.muted} text-center`}>Cancel</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet visible={selected !== null} onClose={() => setSelected(null)} title={selected?.categoryName}>
        {selected && (
          <>
            <View className="gap-3">
              <Field label="Limit, every month" value={editAmount} onChangeText={setEditAmount} prefix="₹" numeric />
              <View className="flex-row items-center pt-2">
                <View className="flex-1 pr-4">
                  <Text className={t.body}>Carry unspent money over</Text>
                  <Text className={`${t.faint} mt-0.5 leading-4`}>
                    What is left at the end of a month is added to the next. Going over does not cut the next month.
                  </Text>
                </View>
                <Switch
                  value={editRollover}
                  accessibilityLabel="Carry unspent money over to next month"
                  onValueChange={(on) => {
                    const failed = onRollover(selected.id, on);
                    if (failed) return setEditError(failed);
                    setEditRollover(on);
                  }}
                />
              </View>
            </View>
            <ErrorText message={editError} />
            <View className="gap-3 pt-5">
              <PrimaryButton label="Save" onPress={submitEdit} />
              <GhostButton label="Remove budget" onPress={() => confirmDelete(selected)} />
              <Pressable onPress={() => setSelected(null)} className="py-2">
                <Text className={`${t.muted} text-center`}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </BottomSheet>
    </View>
  );
};
