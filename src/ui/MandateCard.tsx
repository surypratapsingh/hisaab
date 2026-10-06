import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { TrackedMandate } from '@/capture/mandates';
import { Field } from './components';
import { t, ink } from './theme';
import { useAmount } from './kit';
import { MoneyCard, SmallButton } from './parts';

const HOW_OFTEN: Record<string, string> = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  quarterly: 'every quarter',
  'half-yearly': 'every six months',
  yearly: 'every year',
  'as presented': 'when they charge',
};

/**
 * "A new autopay was set up": one tap to track it, two to name it and say
 * what it is for, or dismiss it if it is not the user's.
 */
export const MandateCard: React.FC<{
  mandate: TrackedMandate;
  onConfirm: (details?: { name?: string; purpose?: string }) => void;
  onDismiss: () => void;
}> = ({ mandate, onConfirm, onDismiss }) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(mandate.payee === 'Unknown payee' ? '' : mandate.payee);
  const [purpose, setPurpose] = useState('');
  const show = useAmount();

  const amount = mandate.amount
    ? `${mandate.upTo ? 'up to ' : ''}${show(mandate.amount)}`
    : 'an amount they choose';
  const often = mandate.frequency ? ` ${HOW_OFTEN[mandate.frequency]}` : '';

  return (
    <MoneyCard>
      <Text className={t.label}>New autopay</Text>
      <Text className={`mt-2 text-[20px] font-semibold ${ink.primary}`}>{mandate.payee}</Text>
      <Text className={`${t.muted} mt-1`}>
        Can take {amount}
        {often} from your account.
      </Text>

      {naming ? (
        <View className="mt-4 gap-3">
          <Field label="Call it" value={name} onChangeText={setName} placeholder="e.g. Netflix family" />
          <Field label="What it is for" value={purpose} onChangeText={setPurpose} placeholder="e.g. Movies, shared with Riya" />
          <SmallButton label="Save" onPress={() => onConfirm({ name, purpose })} flex={false} />
        </View>
      ) : (
        <View className="mt-4 flex-row items-center gap-3">
          <SmallButton label="Yes, track it" onPress={() => onConfirm()} />
          <SmallButton label="Name it" onPress={() => setNaming(true)} outline />
          <Pressable onPress={onDismiss} className="px-1 py-3" accessibilityRole="button">
            <Text className={`text-center text-[14px] ${ink.tertiary}`}>Not mine</Text>
          </Pressable>
        </View>
      )}
    </MoneyCard>
  );
};
