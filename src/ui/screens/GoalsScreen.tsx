import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { Paise, tryRupeeString } from '@/money/money';
import { shortDate } from '@/lib/date';
import { t, ink } from '../theme';
import { useAmount, TAB_BAR_SPACE } from '../kit';
import { Field, ErrorText, PrimaryButton, GhostButton } from '../components';
import { Amount, BottomSheet, EmptyState, MoneyCard, ProgressBar, ScreenHeader } from '../parts';
import type { Outcome } from '../store';

export type GoalItem = {
  id: string;
  name: string;
  targetAmount: Paise;
  savedAmount: Paise;
  targetDate?: string;
};

export interface GoalsScreenProps {
  goals: GoalItem[];
  onAdd: (name: string, targetAmount: Paise, targetDate?: string) => Outcome;
  onContribute: (id: string, amount: Paise) => Outcome;
  onEdit: (id: string, name: string, targetAmount: Paise, targetDate?: string) => Outcome;
  onDelete: (id: string) => void;
}

/** A target you set, and how far along it is. Goals are kept by hand: nothing here reads an account. */
const GoalCard: React.FC<{ goal: GoalItem; onPress: () => void }> = ({ goal, onPress }) => {
  const amount = useAmount();
  const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.savedAmount / goal.targetAmount) * 100)) : 0;
  const reached = goal.savedAmount >= goal.targetAmount;

  return (
    <MoneyCard onPress={onPress} anchor={`goal:${goal.id}`} accessibilityLabel={`${goal.name} goal. Open to add money or edit.`}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-4">
          <Text className={t.heading}>{goal.name}</Text>
          {goal.targetDate && <Text className={`${t.faint} mt-0.5`}>By {shortDate(goal.targetDate)}</Text>}
        </View>
        <Text className={`text-[13px] font-semibold ${reached ? ink.positive : ink.secondary}`}>
          {reached ? 'Reached' : `${pct}%`}
        </Text>
      </View>

      <View className="mt-4 flex-row items-baseline">
        <Amount value={goal.savedAmount} size="figure" paise={false} animate />
        <Text className={`ml-1.5 text-[14px] ${ink.tertiary}`}>of {amount(goal.targetAmount, { paise: false })}</Text>
      </View>

      <View className="mt-3">
        <ProgressBar value={pct} tone="accent" />
      </View>
    </MoneyCard>
  );
};

export const GoalsScreen: React.FC<GoalsScreenProps> = ({ goals, onAdd, onContribute, onEdit, onDelete }) => {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<GoalItem | null>(null);
  const [contribution, setContribution] = useState('');
  const [contribError, setContribError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState<string>();

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string>();

  const openAdd = () => {
    setName('');
    setTarget('');
    setDate('');
    setError(undefined);
    setAdding(true);
  };

  const submitAdd = () => {
    const targetAmount = tryRupeeString(target);
    if (targetAmount === null || targetAmount <= 0) return setError('Enter a target above zero');
    if (date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      return setError('Enter the date as YYYY-MM-DD, or leave it blank');
    }
    const failed = onAdd(name.trim(), targetAmount, date.trim() || undefined);
    if (failed) return setError(failed);
    setAdding(false);
  };

  const openContribute = (goal: GoalItem) => {
    setSelected(goal);
    setContribution('');
    setContribError(undefined);
    setEditing(false);
  };

  const openEdit = (goal: GoalItem) => {
    setEditName(goal.name);
    setEditTarget(String(goal.targetAmount / 100));
    setEditDate(goal.targetDate ?? '');
    setEditError(undefined);
    setEditing(true);
  };

  const submitEdit = () => {
    if (!selected) return;
    const targetAmount = tryRupeeString(editTarget);
    if (targetAmount === null || targetAmount <= 0) return setEditError('Enter a target above zero');
    if (editDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(editDate.trim())) {
      return setEditError('Enter the date as YYYY-MM-DD, or leave it blank');
    }
    const failed = onEdit(selected.id, editName.trim(), targetAmount, editDate.trim() || undefined);
    if (failed) return setEditError(failed);
    setSelected({ ...selected, name: editName.trim(), targetAmount, targetDate: editDate.trim() || undefined });
    setEditing(false);
  };

  const submitContribution = () => {
    if (!selected) return;
    const amount = tryRupeeString(contribution);
    if (amount === null || amount <= 0) return setContribError('Enter an amount above zero');
    const failed = onContribute(selected.id, amount);
    if (failed) return setContribError(failed);
    setSelected(null);
  };

  const confirmDelete = (goal: GoalItem) => {
    Alert.alert('Delete this goal?', goal.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { onDelete(goal.id); setSelected(null); } },
    ]);
  };

  return (
    <View className={t.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Goals"
          subtitle="A target you set for yourself. Add to it whenever you put money aside. Nothing here touches your accounts."
        />

        <View className={t.page}>
          {goals.length === 0 ? (
            <EmptyState
              icon="🏁"
              title="No goals yet"
              body="Name something you are saving for and set a target. You add to it by hand whenever you put money aside."
            />
          ) : (
            goals.map((goal) => <GoalCard key={goal.id} goal={goal} onPress={() => openContribute(goal)} />)
          )}

          <PrimaryButton label="Add a goal" onPress={openAdd} />
        </View>
      </ScrollView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="New goal">
        <View className="gap-3">
          <Field label="What is it for" value={name} onChangeText={setName} placeholder="e.g. Emergency fund" />
          <Field label="Target amount" value={target} onChangeText={setTarget} prefix="₹" placeholder="0" numeric />
          <Field label="Target date (optional)" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        </View>
        <ErrorText message={error} />
        <View className="gap-3 pt-5">
          <PrimaryButton label="Add" onPress={submitAdd} />
          <Pressable onPress={() => setAdding(false)} className="py-2">
            <Text className={`${t.muted} text-center`}>Cancel</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? (editing ? 'Edit goal' : selected.name) : undefined}
      >
        {selected && !editing && (
          <>
            <View className="gap-3">
              <Field
                label="Add to this goal"
                value={contribution}
                onChangeText={setContribution}
                prefix="₹"
                placeholder="0"
                numeric
              />
            </View>
            <ErrorText message={contribError} />
            <View className="gap-3 pt-5">
              <PrimaryButton label="Add" onPress={submitContribution} />
              <GhostButton label="Edit goal" onPress={() => openEdit(selected)} />
              <GhostButton label="Delete goal" onPress={() => confirmDelete(selected)} />
              <Pressable onPress={() => setSelected(null)} className="py-2">
                <Text className={`${t.muted} text-center`}>Close</Text>
              </Pressable>
            </View>
          </>
        )}

        {selected && editing && (
          <>
            <View className="gap-3">
              <Field label="What is it for" value={editName} onChangeText={setEditName} />
              <Field label="Target amount" value={editTarget} onChangeText={setEditTarget} prefix="₹" numeric />
              <Field label="Target date (optional)" value={editDate} onChangeText={setEditDate} placeholder="YYYY-MM-DD" />
            </View>
            <ErrorText message={editError} />
            <View className="gap-3 pt-5">
              <PrimaryButton label="Save" onPress={submitEdit} />
              <Pressable onPress={() => setEditing(false)} className="py-2">
                <Text className={`${t.muted} text-center`}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </BottomSheet>
    </View>
  );
};
