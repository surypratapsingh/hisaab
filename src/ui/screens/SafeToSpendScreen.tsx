import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { isNegative, tryRupeeString, toPlainRupees, type Paise } from '@/money/money';
import { shortDate, isoDate, daysBetween, localDate } from '@/lib/date';
import type { SafeToSpendView, PaydaySource } from '@/repo/analysisViews';
import { Field, ErrorText, PrimaryButton, GhostButton } from '../components';
import type { Outcome } from '../store';
import { t, ink } from '../theme';
import { TAB_BAR_SPACE } from '../kit';
import { Amount, MoneyCard, ScreenHeader, SectionHeader } from '../parts';
import { SafeBattery } from '../motion/SafeBattery';

export interface SafeToSpendScreenProps {
  view: SafeToSpendView;
  onSetPayday: (day: number | null) => Outcome;
  onSetCashFloor: (amount: Paise) => Outcome;
}

const PAYDAY_SOURCE: Record<PaydaySource, string> = {
  set: 'you set this',
  salary: 'from your salary',
  pattern: 'from your regular credits',
};

/** How old a statement balance can get before the screen says so. */
const STALE_AFTER_DAYS = 3;

const PaydayForm: React.FC<{
  initial?: number;
  onSave: (day: number) => Outcome;
  onCancel?: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [day, setDay] = useState(initial ? String(initial) : '');
  const [error, setError] = useState<string>();

  const save = () => {
    const value = Number(day.trim());
    if (!Number.isInteger(value) || value < 1 || value > 31) {
      return setError('Enter a day between 1 and 31');
    }
    const failed = onSave(value);
    if (failed) setError(failed);
  };

  return (
    <View className="gap-4">
      <Field
        label="Day of the month your salary arrives"
        value={day}
        onChangeText={setDay}
        placeholder="e.g. 1"
        numeric
      />
      <ErrorText message={error} />
      <PrimaryButton label="Save" onPress={save} />
      {onCancel && (
        <Pressable onPress={onCancel} className="py-1">
          <Text className={`${t.muted} text-center`}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
};

export const SafeToSpendScreen: React.FC<SafeToSpendScreenProps> = ({
  view,
  onSetPayday,
  onSetCashFloor,
}) => {
  const [editingPayday, setEditingPayday] = useState(false);
  const [floor, setFloor] = useState(
    view.cashFloor > 0 ? toPlainRupees(view.cashFloor) : ''
  );
  const [floorError, setFloorError] = useState<string>();

  const saveFloor = () => {
    const amount = tryRupeeString(floor.trim() || '0');
    if (amount === null || amount < 0) return setFloorError('Enter an amount');
    const failed = onSetCashFloor(amount);
    setFloorError(failed);
  };

  if (view.status === 'needs_payday') {
    return (
      <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Safe to spend"
          subtitle="What is genuinely free to spend depends on how long it has to last. Hisaab could not find a regular salary in your statements, so tell it when yours arrives."
        />
        <View className={t.page}>
          <MoneyCard>
            <PaydayForm onSave={(day) => onSetPayday(day)} />
          </MoneyCard>
        </View>
      </ScrollView>
    );
  }

  const { result, nextIncome, payday, dailyDiscretionary, basisDays, balanceAsOf, leftOut } = view;
  const today = isoDate(new Date());
  const stale =
    balanceAsOf !== undefined &&
    daysBetween(localDate(balanceAsOf), localDate(today)) > STALE_AFTER_DAYS;
  const over = isNegative(result.amount);
  const liquid = result.lines.find((l) => l.kind === 'liquid')?.amount;

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
      <View className={t.page}>
        <View className="pb-6 pt-2">
          <Text className={t.label}>Safe to spend</Text>
          <View className="mt-2">
            <Amount value={result.amount} size="hero" tone={over ? 'negative' : 'neutral'} fit animate />
          </View>
          <Text className={`${t.muted} mt-1`}>
            until {shortDate(nextIncome)} · {result.daysInWindow} {result.daysInWindow === 1 ? 'day' : 'days'}
          </Text>
          {liquid !== undefined && (
            <View className="mt-5">
              <SafeBattery free={result.amount} liquid={liquid} />
            </View>
          )}
          {over && (
            <Text className={`${t.muted} mt-2 leading-5`}>
              More is already spoken for than you have before payday.
            </Text>
          )}
        </View>

        <SectionHeader title="How it adds up" />
        <View className={`${t.card} py-1`} style={{ paddingHorizontal: 20 }}>
          {result.lines.map((row, index) => (
            <View key={`${row.kind}-${index}`}>
              {index > 0 && <View className={t.rule} />}
              <View className="flex-row items-center justify-between py-3.5">
                <Text className={`${t.body} flex-1 pr-4`}>{row.label}</Text>
                <Amount value={row.amount} size="body" tone={isNegative(row.amount) ? 'muted' : 'neutral'} />
              </View>
            </View>
          ))}
          <View className="h-px bg-textPrimary opacity-20 dark:bg-textPrimary-dark" />
          <View className="flex-row items-center justify-between py-3.5">
            <Text className={t.heading}>Safe to spend</Text>
            <Amount value={result.amount} size="body" tone={over ? 'negative' : 'neutral'} />
          </View>
        </View>

        <View className="gap-2 pb-6 pt-3">
          {basisDays > 0 ? (
            <Text className={`${t.faint} leading-4`}>
              Usual spending is <Amount value={dailyDiscretionary} size="small" tone="muted" /> a day, averaged over your
              last {basisDays} days of everyday spending, with regular bills taken out.
            </Text>
          ) : (
            <Text className={`${t.faint} leading-4`}>
              No spending history yet, so nothing is set aside for everyday spending.
            </Text>
          )}
          {stale && (
            <Text className={`${t.faint} leading-4`}>
              Your balance comes from a statement ending {shortDate(balanceAsOf!)}. Import a newer one to bring it
              up to date.
            </Text>
          )}
          {leftOut.length > 0 && (
            <Text className={`${t.faint} leading-4`}>
              Not counted, as the balance is not known yet: {leftOut.join(', ')}. Set it under Accounts.
            </Text>
          )}
        </View>

        <SectionHeader title="Settings" />
        {editingPayday ? (
          <MoneyCard>
            <PaydayForm
              initial={payday.day}
              onSave={(day) => {
                const failed = onSetPayday(day);
                if (!failed) setEditingPayday(false);
                return failed;
              }}
              onCancel={() => setEditingPayday(false)}
            />
          </MoneyCard>
        ) : (
          <MoneyCard>
            <View className="flex-row items-center">
              <View className="flex-1 pr-4">
                <Text className={t.body}>Payday: day {payday.day}</Text>
                <Text className={`${t.faint} mt-0.5`}>{PAYDAY_SOURCE[payday.source]}</Text>
              </View>
              <Pressable onPress={() => setEditingPayday(true)} accessibilityRole="button" hitSlop={8}>
                <Text className={`text-[14px] font-semibold ${ink.accent}`}>Change</Text>
              </Pressable>
            </View>
            {payday.source === 'set' && (
              <Pressable onPress={() => onSetPayday(null)} className="pt-3">
                <Text className={t.faint}>Let Hisaab find it from your statements instead</Text>
              </Pressable>
            )}
          </MoneyCard>
        )}

        <MoneyCard>
          <Field
            label="Minimum balance to keep"
            value={floor}
            onChangeText={setFloor}
            prefix="₹"
            placeholder="0"
            numeric
          />
          <View className="pt-2">
            <ErrorText message={floorError} />
          </View>
          <View className="pt-3">
            <GhostButton label="Save minimum balance" onPress={saveFloor} />
          </View>
        </MoneyCard>
      </View>
    </ScrollView>
  );
};
