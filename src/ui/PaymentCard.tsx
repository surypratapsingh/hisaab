import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { PaySession } from '@/upi/session';
import { matchWindowClosed } from '@/upi/session';
import { paise } from '@/money/money';
import { ChipRow } from './components';
import { t, ink } from './theme';
import { Amount, MoneyCard, SmallButton } from './parts';

const APP_SAID: Record<NonNullable<PaySession['appSaid']>, string> = {
  success: 'Your UPI app said it went through.',
  failure: 'Your UPI app said it did not go through.',
  pending: 'Your UPI app said it is still pending.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8:31 am" today, "27 Sep, 8:31 am" on another day. */
const whenSent = (iso: string, now = new Date()): string => {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? time : `${date.getDate()} ${MONTHS[date.getMonth()]}, ${time}`;
};

/**
 * A payment handed to a UPI app that nothing has settled yet. Hisaab counts it when the bank's own
 * message arrives; until then it only knows the payer tapped Pay. Once the window for that message has
 * closed the card says so plainly and asks the payer: "It went through" records it as their word,
 * "It did not" forgets it. Opening a UPI app is never taken as proof of payment.
 */
export const PaymentCard: React.FC<{
  payment: PaySession;
  accounts: Array<{ id: string; name: string }>;
  onPaid: (accountId: string) => void;
  onNotPaid: () => void;
}> = ({ payment, accounts, onPaid, onNotPaid }) => {
  const [choosing, setChoosing] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const closed = matchWindowClosed(payment);

  return (
    <MoneyCard>
      <Text className={t.label}>{closed ? 'No bank message came' : 'Waiting for your bank'}</Text>
      <View className="mt-3 flex-row items-start justify-between">
        <Text className={`flex-1 pr-3 text-[17px] font-semibold ${ink.primary}`} numberOfLines={2}>
          {payment.name ?? payment.vpa}
        </Text>
        <Amount value={paise(payment.amount)} size="figure" paise />
      </View>
      <Text className={`${t.faint} mt-1`}>Sent to your UPI app at {whenSent(payment.startedAt)}</Text>
      <Text className={`${t.muted} mt-2 leading-5`}>
        {payment.appSaid ? `${APP_SAID[payment.appSaid]} ` : ''}
        {closed
          ? 'Hisaab has not counted this payment. If it went through, say so; if not, forget it.'
          : "Hisaab counts it once your bank's message arrives."}
      </Text>

      {choosing ? (
        <View className="mt-4 gap-3">
          {accounts.length > 1 && (
            <>
              <Text className={t.faint}>Which account did it come out of?</Text>
              <ChipRow options={accounts.map((a) => a.id)} value={accountId} onChange={setAccountId} labelFor={(id) => names.get(id) ?? id} />
            </>
          )}
          <View className="flex-row items-center gap-2">
            <SmallButton label="Yes, record it" onPress={() => accountId && onPaid(accountId)} />
            <Pressable onPress={() => setChoosing(false)} className="px-3 py-3" accessibilityRole="button">
              <Text className={`text-center text-[14px] ${ink.tertiary}`}>Back</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="mt-4 flex-row gap-3">
          <SmallButton
            label="It went through"
            onPress={() => (accounts.length === 1 ? onPaid(accounts[0].id) : setChoosing(true))}
            disabled={accounts.length === 0}
          />
          <SmallButton label="It did not" onPress={onNotPaid} outline />
        </View>
      )}
    </MoneyCard>
  );
};
