import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { sum } from '@/money/money';
import { shortDate } from '@/lib/date';
import type { Id } from '@/lib/ulid';
import type { Bill } from '@/bills/bill';
import type { BillMatch } from '@/bills/repo';
import { ErrorText, PrimaryButton, Label } from '../components';
import type { Outcome } from '../store';
import { t } from '../theme';
import { useAmount } from '../kit';

type Target = { kind: 'entry'; entryId: Id } | { kind: 'new'; accountId: Id } | { kind: 'none' };

export interface BillScreenProps {
  bill: Bill;
  matches: BillMatch[];
  /** Accounts a new expense can come from, cash first. */
  accounts: Array<{ id: string; name: string }>;
  onSave: (target: Target, itemIndexes: number[]) => Outcome;
  onDone: () => void;
}

const Choice: React.FC<{ label: string; detail?: string; chosen: boolean; onPress: () => void }> = ({
  label,
  detail,
  chosen,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    className={`mb-2 rounded-2xl border px-4 py-3 ${chosen ? 'border-textPrimary dark:border-textPrimary-dark bg-textPrimary dark:bg-textPrimary-dark' : 'border-border dark:border-border-dark'}`}
  >
    <Text className={`text-[15px] font-medium ${chosen ? 'text-background dark:text-background-dark' : 'text-textPrimary dark:text-textPrimary-dark'}`}>{label}</Text>
    {detail && <Text className={`mt-0.5 text-[12px] ${chosen ? 'text-textTertiary dark:text-textTertiary-dark' : 'text-textTertiary dark:text-textTertiary-dark'}`}>{detail}</Text>}
  </Pressable>
);

/**
 * What a bill said, for the user to confirm: which lines are real items, and
 * which payment the bill belongs to. Nothing is saved until they say so.
 */
export const BillScreen: React.FC<BillScreenProps> = ({ bill, matches, accounts, onSave, onDone }) => {
  const [kept, setKept] = useState<boolean[]>(bill.items.map(() => true));
  const [target, setTarget] = useState<Target>(
    matches[0]
      ? { kind: 'entry', entryId: matches[0].entryId }
      : accounts[0]
        ? { kind: 'new', accountId: accounts[0].id as Id }
        : { kind: 'none' }
  );
  const [error, setError] = useState<string>();
  const amount = useAmount();

  const chosenTotal = sum(bill.items.filter((_, i) => kept[i]).map((i) => i.amount));
  const same = (other: Target) => JSON.stringify(other) === JSON.stringify(target);

  const save = () => {
    setError(undefined);
    const failed = onSave(
      target,
      kept.flatMap((k, i) => (k ? [i] : []))
    );
    if (failed) return setError(failed);
    onDone();
  };

  return (
    <ScrollView className={t.screen} contentContainerClassName="pb-12" keyboardShouldPersistTaps="handled">
      <View className={t.page}>
        <View className="pt-6 pb-4">
          <Text className={t.label}>{bill.date ? shortDate(bill.date) : 'Bill'}</Text>
          <Text className={`${t.title} mt-2`}>{bill.merchant ?? 'A bill'}</Text>
          {bill.total !== undefined && (
            <Text className="mt-1 text-[22px] font-semibold text-textPrimary dark:text-textPrimary-dark">{amount(bill.total)}</Text>
          )}
        </View>

        {bill.items.length === 0 ? (
          <Text className={`${t.muted} pb-4`}>
            No item lines could be read from this bill. You can still file its total below.
          </Text>
        ) : (
          <>
            <Label>Items · tap to leave one out</Label>
            {bill.items.map((item, index) => (
              <Pressable
                key={`${item.name}-${index}`}
                onPress={() => setKept(kept.map((k, i) => (i === index ? !k : k)))}
                className="flex-row items-center justify-between border-b border-border dark:border-border-dark py-3"
              >
                <View className="flex-1 flex-row items-center pr-4">
                  <Text className={`mr-3 text-[18px] ${kept[index] ? 'text-positive dark:text-positive-dark' : 'text-textTertiary dark:text-textTertiary-dark'}`}>
                    {kept[index] ? '✓' : '○'}
                  </Text>
                  <View className="flex-1">
                    <Text className={kept[index] ? t.body : `${t.body} text-textTertiary dark:text-textTertiary-dark line-through`}>
                      {item.name}
                    </Text>
                    {item.quantity !== undefined && item.quantity > 1 && (
                      <Text className={t.faint}>{item.quantity} pieces</Text>
                    )}
                  </View>
                </View>
                <Text className={kept[index] ? t.amount : `${t.amount} text-textTertiary dark:text-textTertiary-dark`}>{amount(item.amount)}</Text>
              </Pressable>
            ))}
            {!bill.itemsMatchTotal && bill.total !== undefined && (
              <Text className="mt-3 text-[13px] text-warning dark:text-warning-dark">
                Ticked items come to {amount(chosenTotal)}, the bill says {amount(bill.total)}. Leave out
                anything that is not an item, or save as it is.
              </Text>
            )}
          </>
        )}

        <View className="pt-8">
          <Label>This bill is for</Label>
          {matches.map((m) => (
            <Choice
              key={m.entryId}
              label={m.description}
              detail={`${shortDate(m.date)} · ${m.account} · ${amount(m.amount)}`}
              chosen={same({ kind: 'entry', entryId: m.entryId })}
              onPress={() => setTarget({ kind: 'entry', entryId: m.entryId })}
            />
          ))}
          {accounts.map((a) => (
            <Choice
              key={a.id}
              label={`New expense from ${a.name}`}
              detail={matches.length ? 'If the payment is not in the list above' : undefined}
              chosen={same({ kind: 'new', accountId: a.id as Id })}
              onPress={() => setTarget({ kind: 'new', accountId: a.id as Id })}
            />
          ))}
          <Choice
            label="Just track the items"
            detail="Do not record any money"
            chosen={same({ kind: 'none' })}
            onPress={() => setTarget({ kind: 'none' })}
          />
        </View>

        <View className="gap-3 pt-6">
          <ErrorText message={error} />
          <PrimaryButton label="Save bill" onPress={save} />
        </View>
      </View>
    </ScrollView>
  );
};
