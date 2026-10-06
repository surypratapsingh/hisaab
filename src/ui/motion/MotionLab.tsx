import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { BottomSheet, SmallButton } from '../parts';
import { t } from '../theme';
import { emitMoment, type Moment, type MomentType } from './moments';
import { SafeBattery } from './SafeBattery';
import { previewWeather } from './MoneyWeather';

/**
 * A development-only way to watch each motion, for tuning it. It plays the
 * animation and its haptic and sound and writes nothing: no entry, no goal, no
 * balance. Opened by a long press on Home's greeting, and only in a development
 * build (`__DEV__`); a release build never shows it.
 */

type Preview = { label: string; type: MomentType; amount?: number; text?: string };

const PREVIEWS: Preview[] = [
  { label: 'Salary arrives', type: 'SALARY_RECEIVED', amount: 680_000 },
  { label: 'Income', type: 'INCOME_RECEIVED', amount: 120_000 },
  { label: 'Expense (Shopping)', type: 'EXPENSE_RECORDED', amount: 129_900, text: 'Shopping' },
  { label: 'Invested', type: 'INVESTED', amount: 500_000 },
  { label: 'Saved toward a goal', type: 'SAVING_ADDED', amount: 200_000, text: 'Preview goal' },
  { label: 'Goal at 50%', type: 'GOAL_50', amount: 1_000_000, text: 'Preview goal' },
  { label: 'Goal complete', type: 'GOAL_COMPLETE', amount: 2_000_000, text: 'Preview goal' },
  { label: 'Budget kept', type: 'BUDGET_COMPLETED', text: 'Preview budget' },
  { label: 'Transaction reviewed', type: 'TRANSACTION_REVIEWED', text: 'Food' },
  { label: 'Backup made', type: 'BACKUP_COMPLETED' },
  { label: 'Net worth line', type: 'NET_WORTH_MILESTONE', amount: 10_000_000 },
];

let serial = 0;

/** Sample levels for the battery: what is free, of 100,000 rupees held (in paise). */
const LEVELS = [72_000_00, 30_000_00, 6_000_00, -2_000_00, 90_000_00];
const HELD = 100_000_00;

export const MotionLab: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [level, setLevel] = useState(0);
  const play = (preview: Preview) => {
    onClose();
    // Let the sheet finish leaving, so the effect is seen on Home itself.
    setTimeout(() => {
      const moment: Moment = {
        type: preview.type,
        key: `PREVIEW:${preview.type}:${(serial += 1)}`,
        at: Date.now(),
        amount: preview.amount,
        label: preview.text,
      };
      emitMoment(moment);
    }, 450);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Motion preview">
      <Text className={`${t.faint} mb-3`}>Development builds only. Plays the motion; saves nothing.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PREVIEWS.map((preview) => (
          <View key={preview.label} style={{ width: '48.5%' }}>
            <SmallButton label={preview.label} onPress={() => play(preview)} outline flex={false} />
          </View>
        ))}
      </View>
      <Text className={`${t.faint} mb-2 mt-5`}>Safe-to-spend battery, sample figures</Text>
      <SafeBattery free={LEVELS[level]} liquid={HELD} compact />
      <View style={{ marginTop: 10, flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <SmallButton label="Next level" onPress={() => setLevel((level + 1) % LEVELS.length)} outline flex={false} />
        </View>
      </View>
      <Text className={`${t.faint} mb-2 mt-5`}>Home's background mood</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['healthy', 'commitments', 'pressure', 'normal'] as const).map((mood) => (
          <View key={mood} style={{ width: '48.5%' }}>
            <SmallButton
              label={mood}
              onPress={() => {
                previewWeather(mood);
                onClose();
              }}
              outline
              flex={false}
            />
          </View>
        ))}
        <View style={{ width: '48.5%' }}>
          <SmallButton
            label="real"
            onPress={() => {
              previewWeather(null);
              onClose();
            }}
            outline
            flex={false}
          />
        </View>
      </View>
    </BottomSheet>
  );
};
