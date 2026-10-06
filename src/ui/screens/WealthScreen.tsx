import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { isNegative } from '@/money/money';
import type { WealthView, WealthPart, HoldingRow } from '@/wealth/repo';
import { asOfLine } from '@/wealth/labels';
import { t, ink } from '../theme';
import { TAB_BAR_SPACE, useAmount } from '../kit';
import { Amount, MoneyCard, ScreenHeader, SectionHeader } from '../parts';
import { PrimaryButton, GhostButton } from '../components';
import { WealthOrbit } from '../motion/WealthOrbit';

export interface WealthScreenProps {
  wealth: WealthView;
  onImportCas: () => void;
}

/** Whole units with Indian grouping, and the fraction as printed: 1,120.788. */
const units = (milli: number): string => {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, '0');
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest ? `${rest},` : ''}${last3}.${fraction}`;
};

const Holding: React.FC<{ holding: HoldingRow }> = ({ holding }) => (
  <View className="flex-row items-start justify-between py-3">
    <View className="flex-1 pr-4">
      <Text className={t.body} numberOfLines={2}>
        {holding.name}
      </Text>
      {holding.unitsMilli !== undefined && (
        <Text className={`${t.faint} mt-0.5`}>{units(holding.unitsMilli)} units</Text>
      )}
    </View>
    <View className="items-end">
      <Amount value={holding.value} size="body" />
      {holding.gain !== undefined && (
        <View className="mt-0.5">
          <Amount value={holding.gain} size="small" signed tone={isNegative(holding.gain) ? 'negative' : 'positive'} />
        </View>
      )}
    </View>
  </View>
);

const Part: React.FC<{ part: WealthPart }> = ({ part }) => {
  const [open, setOpen] = useState(part.holdings.length > 0 && part.holdings.length <= 5);
  return (
    <MoneyCard gap={12}>
      <Pressable
        onPress={() => part.holdings.length > 0 && setOpen(!open)}
        accessibilityRole={part.holdings.length > 0 ? 'button' : undefined}
        className="flex-row items-center justify-between"
      >
        <View className="flex-1 pr-4">
          <Text className={t.heading}>{part.name}</Text>
          <Text className={`${t.faint} mt-0.5`}>{asOfLine(part)}</Text>
        </View>
        {part.unknown ? (
          <Text className={`text-[13px] ${ink.tertiary}`}>Not known</Text>
        ) : (
          <Amount value={part.value} size="figure" />
        )}
      </Pressable>
      {part.holdings.length > 0 && (
        <>
          {open && (
            <View className={`${t.rule} mt-3`} />
          )}
          {open && part.holdings.map((holding) => <Holding key={holding.id} holding={holding} />)}
          <Pressable onPress={() => setOpen(!open)} className="pt-2">
            <Text className={`text-[13px] font-medium ${ink.accent}`}>
              {open ? 'Hide holdings' : `Show ${part.holdings.length} holdings`}
            </Text>
          </Pressable>
        </>
      )}
    </MoneyCard>
  );
};

export const WealthScreen: React.FC<WealthScreenProps> = ({ wealth, onImportCas }) => {
  const hasInvestments = wealth.parts.some((p) => p.kind === 'investment' && p.holdings.length > 0);
  const show = useAmount();
  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}>
      <ScreenHeader title="Wealth" subtitle="Bank, cash and investments, each as of its latest source" />
      <View className={t.page}>
        <MoneyCard>
          <Text className={t.label}>Total wealth</Text>
          <View className="mt-2" accessibilityLabel={`Total wealth ${show(wealth.total)}`}>
            <WealthOrbit wealth={wealth} />
          </View>
        </MoneyCard>

        {wealth.parts.map((part) => (
          <Part key={part.accountId} part={part} />
        ))}

        <View className="pt-2">
          <SectionHeader title={hasInvestments ? 'Refresh your investments' : 'Add your mutual funds and stocks'} />
          <MoneyCard>
            <Text className={`${t.muted} leading-5`}>
              Ask for a free Consolidated Account Statement (CAS): from camsonline.com or
              kfintech.com for mutual funds, or from NSDL/CDSL for your demat account. It arrives
              by email as a locked PDF; import it here and the phone reads it. Nothing is uploaded.
            </Text>
            <View className="mt-4">
              <PrimaryButton label="Import a CAS" onPress={onImportCas} />
            </View>
          </MoneyCard>

          <MoneyCard>
            <Text className={t.heading}>Fastest: MF Central</Text>
            <Text className={`${t.muted} mt-1 leading-5`}>
              One statement with every mutual fund you hold, from CAMS and KFintech together.
            </Text>
            {[
              'Open MF Central and log in with your PAN and the OTP sent to your phone.',
              'Choose "CAS" (Consolidated Account Statement) and pick "Detailed".',
              'Select all AMCs, set the period to "Since inception", and submit.',
              'Download the PDF (its password is usually your PAN in capitals).',
              'Share the PDF to Hisaab, or tap Import a CAS above.',
            ].map((step, i) => (
              <View key={step} className="mt-3 flex-row">
                <Text className={`w-6 text-[15px] font-semibold ${ink.primary}`}>{i + 1}</Text>
                <Text className={`${t.body} flex-1 leading-5`}>{step}</Text>
              </View>
            ))}
            <View className="mt-4">
              <GhostButton label="Open MF Central" onPress={() => Linking.openURL('https://app.mfcentral.com')} />
            </View>
            <Text className={`${t.faint} mt-3`}>
              MF Central&apos;s QR sharing only works with registered distributors, so Hisaab uses the
              statement instead. You stay in control of it.
            </Text>
          </MoneyCard>
        </View>
      </View>
    </ScrollView>
  );
};
