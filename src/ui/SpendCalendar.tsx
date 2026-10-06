import React from 'react';
import { View, Text } from 'react-native';
import type { Paise } from '@/money/money';
import { shades } from '@/lib/heat';
import { t } from './theme';
import { useAmount, useInk } from './kit';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
// How dark a day is drawn for its share of the busiest day: barely, lightly, clearly, fully.
const SHADES = [0.14, 0.32, 0.58, 0.88];

/**
 * The month as a calendar, each day shaded by how much went out that day, weeks
 * starting on Monday. Today is ringed; days still to come are left blank. It
 * only shows what happened — no target, no verdict on a day.
 */
export const SpendCalendar: React.FC<{ days: Paise[]; today: Date }> = ({ days, today }) => {
  const { dark, ink } = useInk();
  const amount = useAmount();

  const dayNow = today.getDate();
  const lead = (new Date(today.getFullYear(), today.getMonth(), 1).getDay() + 6) % 7;
  const cells: Array<number | null> = [...Array(lead).fill(null), ...days.map((_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const soFar = days.slice(0, dayNow);
  const levels = shades(soFar);
  const quiet = soFar.filter((d) => d <= 0).length;
  const shade = (level: number) => (dark ? `rgba(250,250,250,${SHADES[level - 1]})` : `rgba(23,23,23,${SHADES[level - 1]})`);

  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingBottom: 4 }}>
            <Text className={t.faint}>{d}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: 'row' }}>
          {week.map((day, i) => {
            if (day === null) return <View key={i} style={{ width: `${100 / 7}%`, height: 38 }} />;
            const spent = days[day - 1] ?? (0 as Paise);
            const level = day <= dayNow ? levels[day - 1] : 0;
            const heavy = level >= 3;
            return (
              <View key={i} style={{ width: `${100 / 7}%`, padding: 2 }}>
                <View
                  accessibilityLabel={day <= dayNow ? `Day ${day}: ${amount(spent, { paise: false })}` : `Day ${day}`}
                  style={{
                    height: 34,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: level > 0 ? shade(level) : day <= dayNow ? (dark ? '#1F1F1F' : '#F0F0EE') : 'transparent',
                    borderWidth: day === dayNow ? 1.5 : 0,
                    borderColor: ink,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: day === dayNow ? '700' : '500',
                      color: heavy ? (dark ? '#171717' : '#FFFFFF') : day <= dayNow ? ink : dark ? '#525252' : '#BDBDBD',
                    }}
                  >
                    {day}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}

      <Text className={`${t.faint} mt-3`}>
        {quiet === 0 ? 'Something went out every day so far' : `${quiet} day${quiet === 1 ? '' : 's'} with nothing spent so far`}
      </Text>
      <View className="mt-2 flex-row items-center justify-end">
        <View className="flex-row items-center">
          <Text className={`${t.faint} mr-2`}>less</Text>
          {SHADES.map((_, i) => (
            <View key={i} style={{ width: 12, height: 12, borderRadius: 4, marginLeft: 3, backgroundColor: shade(i + 1) }} />
          ))}
          <Text className={`${t.faint} ml-2`}>more</Text>
        </View>
      </View>
    </View>
  );
};
