import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable } from 'react-native';
import { tryRupeeString } from '@/money/money';
import { isoDate } from '@/lib/date';
import type { Id } from '@/lib/ulid';
import type { ManualKind, ManualTransaction } from '@/repo/manual';
import { Field, ChipRow, ErrorText, PrimaryButton, Label } from '../components';
import type { Outcome } from '../store';
import { t, ink, bg, line } from '../theme';
import { categoryLook, useInk, TAB_BAR_SPACE } from '../kit';
import { EmptyState, ScreenHeader, SegmentedControl } from '../parts';

export interface AddTransactionScreenProps {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  onSave: (input: ManualTransaction) => Outcome;
  onDone: () => void;
  /** Opens already set up, e.g. as spending from Cash after "Where did it go?". */
  preset?: { kind: ManualKind; accountId?: string; title?: string };
}

const KINDS: ManualKind[] = ['expense', 'income', 'transfer', 'investment'];

const KIND_NAMES: Record<ManualKind, string> = {
  income: 'Income',
  investment: 'Investment',
  expense: 'Expense',
  transfer: 'Transfer',
};

const PLACEHOLDERS: Record<ManualKind, string> = {
  income: 'e.g. September salary',
  investment: 'e.g. Index fund SIP',
  expense: 'e.g. Rent share',
  transfer: 'Optional, e.g. ATM top-up',
};

const EXPLAIN: Record<ManualKind, string> = {
  income: 'Money that came in.',
  investment:
    'Moves money into your Investments account. It is still yours, so it is not counted as spending.',
  expense: 'Money that went out.',
  transfer: 'Money moved between two of your own accounts. Not spending and not income.',
};

export const AddTransactionScreen: React.FC<AddTransactionScreenProps> = ({
  accounts,
  categories,
  onSave,
  onDone,
  preset,
}) => {
  const [kind, setKind] = useState<ManualKind>(preset?.kind ?? 'expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(preset?.accountId ?? accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [date, setDate] = useState(isoDate(new Date()));
  const [error, setError] = useState<string>();
  const { colors } = useInk();

  if (accounts.length === 0) {
    return (
      <View className={t.screen}>
        <EmptyState
          icon="🏦"
          title="Add an account first"
          body="Transactions are recorded against one of your accounts. Add one under More, then Accounts."
        />
      </View>
    );
  }

  const accountIds = accounts.map((a) => a.id);
  // A chosen destination stops counting once it becomes the source.
  const otherIds = accountIds.filter((id) => id !== accountId);
  const destination = otherIds.includes(toAccountId) ? toAccountId : (otherIds[0] ?? '');

  const save = () => {
    setError(undefined);

    const paid = tryRupeeString(amount);
    if (paid === null || paid <= 0) return setError('Enter an amount');

    const failed = onSave({
      kind,
      amount: paid,
      accountId: accountId as Id,
      toAccountId: kind === 'transfer' ? ((destination || undefined) as Id | undefined) : undefined,
      description,
      occurredAt: date.trim(),
      categoryId: kind === 'expense' ? (categoryId as Id) : undefined,
    });

    if (failed) return setError(failed);
    onDone();
  };

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryIds = categories.map((c) => c.id);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE + 24 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Add transaction" />
      <View className={`${t.page} gap-5`}>
        <View>
          <SegmentedControl options={KINDS} value={kind} onChange={setKind} labelFor={(k) => KIND_NAMES[k]} />
          <Text className={`${t.faint} mt-2`}>{EXPLAIN[kind]}</Text>
        </View>

        <View className="flex-row items-center justify-center py-4">
          <Text style={{ fontSize: 36, fontWeight: '600', color: colors.textTertiary, marginRight: 6 }}>₹</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            keyboardType="decimal-pad"
            autoFocus
            accessibilityLabel="Amount"
            style={{ fontSize: 44, fontWeight: '700', color: colors.textPrimary, minWidth: 90, textAlign: 'center', padding: 0 }}
          />
        </View>

        <Field
          label={kind === 'transfer' ? 'Note' : 'What was it'}
          value={description}
          onChangeText={setDescription}
          placeholder={PLACEHOLDERS[kind]}
        />

        {kind === 'expense' && (
          <View>
            <Label>Category</Label>
            <View className="flex-row flex-wrap gap-2">
              {categoryIds.map((id) => {
                const name = categoryName.get(id) ?? id;
                const look = categoryLook(name);
                const on = id === categoryId;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setCategoryId(id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    className={`flex-row items-center rounded-full border px-3 py-2 ${
                      on ? 'border-textPrimary bg-textPrimary dark:border-textPrimary-dark dark:bg-textPrimary-dark' : `${line.border} ${bg.surface}`
                    }`}
                  >
                    <Text style={{ fontSize: 14, marginRight: 6, color: look.ink }}>{look.symbol}</Text>
                    <Text className={`text-[13px] ${on ? 'font-semibold text-background dark:text-background-dark' : ink.secondary}`}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View>
          <Label>{kind === 'income' ? 'Into' : 'From'}</Label>
          <ChipRow
            options={accountIds}
            value={accountId}
            onChange={setAccountId}
            labelFor={(id) => accountName.get(id) ?? id}
          />
        </View>

        {kind === 'transfer' && (
          <View>
            <Label>To</Label>
            <ChipRow
              options={otherIds}
              value={destination}
              onChange={setToAccountId}
              labelFor={(id) => accountName.get(id) ?? id}
            />
          </View>
        )}

        <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />

        <Text className={`${t.faint} leading-4`}>
          If it later appears on a statement you import, it is matched and not counted twice.
        </Text>

        <ErrorText message={error} />
        <PrimaryButton label="Save transaction" onPress={save} />
      </View>
    </ScrollView>
  );
};
