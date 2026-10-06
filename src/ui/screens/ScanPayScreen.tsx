import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TextInput, Pressable } from 'react-native';
import { tryRupeeString, type Paise } from '@/money/money';
import { parseUpi, type UpiRequest } from '@/upi/link';
import { Field, ErrorText, PrimaryButton, GhostButton, Label } from '../components';
import { categoryLook, useInk, TAB_BAR_SPACE } from '../kit';
import type { Outcome } from '../store';
import { t, bg, ink, line } from '../theme';
import { Amount, MoneyCard, ScreenHeader } from '../parts';

export interface ScanPayScreenProps {
  /** Opens the scanner: the code's text, or null when the user backs out. */
  scan: () => Promise<string | null>;
  categories: Array<{ id: string; name: string }>;
  /** The category this payee was paid under before, or its kind of shop points at. */
  suggestCategory: (request: UpiRequest) => string | undefined;
  /** Remembers the payment and opens the UPI app; resolves when that app closes. An error message, or nothing. */
  onPay: (request: UpiRequest, amount: Paise, categoryId?: string) => Promise<Outcome>;
  onDone: () => void;
}

type Step =
  | { kind: 'scanning' }
  | { kind: 'idle' }
  | { kind: 'typing' }
  | { kind: 'refused'; reason: string }
  | { kind: 'review'; request: UpiRequest };

const LATER = '';

/**
 * Scan a UPI code, check who it pays, and hand it to a UPI app. Hisaab never moves money: the UPI
 * app asks for the PIN and the bank does the rest. The payment then waits on Home until the bank's own
 * message says it went through.
 */
export const ScanPayScreen: React.FC<ScanPayScreenProps> = ({ scan, categories, suggestCategory, onPay, onDone }) => {
  const [step, setStep] = useState<Step>({ kind: 'scanning' });
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState(LATER);
  const [error, setError] = useState<string>();
  const [paying, setPaying] = useState(false);
  const [upiId, setUpiId] = useState('');
  const opened = useRef(false);
  const { colors } = useInk();

  const review = (text: string) => {
    const read = parseUpi(text);
    if (read.isErr()) return setStep({ kind: 'refused', reason: read.error });
    setAmount('');
    setCategoryId(suggestCategory(read.value) ?? LATER);
    setStep({ kind: 'review', request: read.value });
  };

  const scanOnce = async () => {
    setStep({ kind: 'scanning' });
    setError(undefined);
    try {
      const text = await scan();
      // Backing out of the scanner lands on the launcher, not out of the screen.
      if (text === null) return setStep({ kind: 'idle' });
      review(text);
    } catch (e) {
      setStep({ kind: 'refused', reason: (e as Error).message ?? 'The scanner could not be opened.' });
    }
  };

  // The scanner opens as soon as the screen does: that is the whole point of the shortcut.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void scanOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (step.kind === 'scanning') {
    return (
      <View className={`${t.screen} items-center justify-center`}>
        <ActivityIndicator color={colors.textPrimary} />
        <Text className={`${t.muted} mt-3`}>Opening the scanner…</Text>
      </View>
    );
  }

  if (step.kind === 'idle' || step.kind === 'typing') {
    const typing = step.kind === 'typing';
    return (
      <ScrollView className={t.screen} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
        <ScreenHeader title="Scan and pay" subtitle="Scan any UPI code. Your UPI app does the paying; Hisaab keeps the record." />
        <View className={`${t.page} gap-4`}>
          <PrimaryButton label="Open scanner" onPress={() => void scanOnce()} />
          {typing ? (
            <MoneyCard>
              <Field label="UPI ID" value={upiId} onChangeText={setUpiId} placeholder="name@bank" />
              <View className="pt-3">
                <ErrorText message={error} />
              </View>
              <View className="gap-3 pt-3">
                <PrimaryButton
                  label="Continue"
                  onPress={() => {
                    setError(undefined);
                    const id = upiId.trim();
                    if (!id) return setError('Enter the UPI ID you want to pay');
                    // The same checks as a scanned code: an address that is not one is refused.
                    review(`upi://pay?pa=${encodeURIComponent(id)}`);
                  }}
                />
                <Pressable onPress={() => setStep({ kind: 'idle' })} className="py-2" accessibilityRole="button">
                  <Text className={`${t.muted} text-center`}>Cancel</Text>
                </Pressable>
              </View>
            </MoneyCard>
          ) : (
            <Pressable onPress={() => setStep({ kind: 'typing' })} className="py-3" accessibilityRole="button">
              <Text className={`text-center text-[15px] font-semibold ${ink.accent}`}>Enter a UPI ID instead</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    );
  }

  if (step.kind === 'refused') {
    return (
      <View className={t.screen}>
        <ScreenHeader title="Cannot use this" />
        <View className={`${t.page} gap-4`}>
          <Text className={`${t.muted} leading-5`}>{step.reason}</Text>
          <PrimaryButton label="Scan again" onPress={() => void scanOnce()} />
          <GhostButton label="Close" onPress={onDone} />
        </View>
      </View>
    );
  }

  const { request } = step;
  const fixed = request.amount;
  const typed = tryRupeeString(amount);
  const toPay = fixed ?? (typed !== null && typed > 0 ? typed : undefined);

  const pay = async () => {
    if (toPay === undefined) return setError('Enter the amount to pay');
    setError(undefined);
    setPaying(true);
    const failed = await onPay(request, toPay, categoryId === LATER ? undefined : categoryId);
    setPaying(false);
    if (failed) return setError(failed);
    onDone();
  };

  const options = [LATER, ...categories.map((c) => c.id)];
  const names = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE + 24 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Pay to" />
      <View className={`${t.page} gap-5`}>
        <MoneyCard gap={0}>
          <Text className={`text-[22px] font-semibold ${ink.primary}`}>{request.name ?? request.vpa}</Text>
          <Text className={`${t.muted} mt-1`}>{request.vpa}</Text>
          {(request.note || request.reference) && (
            <Text className={`${t.faint} mt-1`}>{[request.note, request.reference].filter(Boolean).join(' · ')}</Text>
          )}
          <Text className={`${t.faint} mt-3 leading-4`}>
            Check that this is who you mean to pay. Whoever printed the code chose the name.
          </Text>
        </MoneyCard>

        {fixed !== undefined ? (
          <View className="items-center py-2">
            <Label>Amount</Label>
            <Amount value={fixed} size="hero" paise />
          </View>
        ) : (
          <View className="flex-row items-center justify-center py-2">
            <Text style={{ fontSize: 36, fontWeight: '600', color: colors.textTertiary, marginRight: 6 }}>₹</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              accessibilityLabel="Amount"
              style={{ fontSize: 44, fontWeight: '700', color: colors.textPrimary, minWidth: 90, textAlign: 'center', padding: 0 }}
            />
          </View>
        )}

        <View>
          <Label>Category</Label>
          <View className="flex-row flex-wrap gap-2">
            {options.map((id) => {
              const name = id === LATER ? 'Decide later' : (names.get(id) ?? id);
              const look = id === LATER ? undefined : categoryLook(name);
              const on = id === categoryId;
              return (
                <Pressable
                  key={id || 'later'}
                  onPress={() => setCategoryId(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  className={`flex-row items-center rounded-full border px-3 py-2 ${
                    on ? 'border-textPrimary bg-textPrimary dark:border-textPrimary-dark dark:bg-textPrimary-dark' : `${line.border} ${bg.surface}`
                  }`}
                >
                  {look && <Text style={{ fontSize: 14, marginRight: 6, color: look.ink }}>{look.symbol}</Text>}
                  <Text className={`text-[13px] ${on ? 'font-semibold text-background dark:text-background-dark' : ink.secondary}`}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <ErrorText message={error} />
        <PrimaryButton label={paying ? 'Opening your UPI app…' : 'Pay with UPI app'} onPress={() => void pay()} disabled={paying} />
        <Text className={`${t.faint} -mt-2 text-center leading-4`}>
          Your UPI app asks for your PIN. Hisaab counts the payment once your bank's message arrives.
        </Text>
        <GhostButton label="Scan a different code" onPress={() => void scanOnce()} />
      </View>
    </ScrollView>
  );
};
