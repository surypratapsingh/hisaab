import React from 'react';
import { View, Text, ScrollView, Switch } from 'react-native';
import { RELOCK_AFTER_MS } from '@/security/applock';
import { t, ink } from '../theme';
import type { ThemeChoice, MotionChoice } from '../store';
import { DataSection, type DataControls } from '../DataSection';
import { TAB_BAR_SPACE, useInk } from '../kit';
import { MoneyCard, ScreenHeader, SectionHeader, SegmentedControl } from '../parts';
import { useFollowingPhone, useMotionPrefs } from '../motion/useMotion';

export interface SettingsScreenProps {
  /** Light, dark or the phone's own setting. */
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  /** How much the app moves, and whether it may make a sound or a buzz. */
  onMotionChange: (motion: MotionChoice) => void;
  onSoundChange: (on: boolean) => void;
  onHapticsChange: (on: boolean) => void;
  /** Backup, restore and delete. */
  data: DataControls;
  /** Whether the lock screen is on for this build (it is always on in a release). */
  lockOn: boolean;
}

const THEMES: ThemeChoice[] = ['light', 'dark', 'system'];
const THEME_NAMES: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'Phone' };

const MOTIONS: MotionChoice[] = ['full', 'reduced', 'none'];
const MOTION_NAMES: Record<MotionChoice, string> = { full: 'Full', reduced: 'Reduced', none: 'None' };
const MOTION_NOTES: Record<MotionChoice, string> = {
  full: 'Money moves: figures count up, particles carry money in and out, and the rare big moments play out.',
  reduced: 'Figures still settle and things fade, but nothing travels: no particles, no big movement.',
  none: 'Nothing animates. What changes simply changes.',
};

/** How you look at Hisaab, and what happens to your data. */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  theme,
  onThemeChange,
  onMotionChange,
  onSoundChange,
  onHapticsChange,
  data,
  lockOn,
}) => {
  const { colors } = useInk();
  const prefs = useMotionPrefs();
  const following = useFollowingPhone();
  const toggle = (label: string, note: string, value: boolean, onChange: (on: boolean) => void) => (
    <View className="flex-row items-center py-2">
      <View className="flex-1 pr-4">
        <Text className={`text-[15px] font-semibold ${ink.primary}`}>{label}</Text>
        <Text className={`${t.faint} mt-0.5 leading-4`}>{note}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
        thumbColor={value ? colors.onAccent : colors.textTertiary}
      />
    </View>
  );

  return (
    <ScrollView className={t.screen} contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Settings" subtitle="Appearance and your data" />
      <View className={t.page}>
        <SectionHeader title="Appearance" />
        <SegmentedControl options={THEMES} value={theme} onChange={onThemeChange} labelFor={(choice) => THEME_NAMES[choice]} />
        <Text className={`${t.faint} mb-6 mt-2`}>“Phone” follows your phone’s own light or dark setting.</Text>

        <SectionHeader title="Motion" />
        <SegmentedControl options={MOTIONS} value={prefs.motion} onChange={onMotionChange} labelFor={(choice) => MOTION_NAMES[choice]} />
        <Text className={`${t.faint} mt-2 leading-4`}>{MOTION_NOTES[prefs.motion]}</Text>
        {following && (
          <Text className={`${t.faint} mt-1 leading-4`}>
            Your phone has animations turned off, so this starts on Reduced. Choose Full to see money move.
          </Text>
        )}
        <View style={{ height: 16 }} />
        <MoneyCard>
          {toggle('Sound', 'A few short, quiet sounds for moments that matter. Silent when your phone is silent.', prefs.sound, onSoundChange)}
          <View className={`${t.rule} my-1`} />
          {toggle('Haptics', 'A light tap on your finger for the same moments.', prefs.haptics, onHapticsChange)}
        </MoneyCard>

        <SectionHeader title="Security" />
        <MoneyCard>
          <Text className={`text-[15px] font-semibold ${ink.primary}`}>App lock</Text>
          <Text className={`${t.muted} mt-1 leading-5`}>
            {lockOn
              ? `Opens with your fingerprint or screen lock, and asks again after ${Math.round(RELOCK_AFTER_MS / 1000)} seconds away.`
              : 'Off in this development build. A released app always asks for your fingerprint or screen lock.'}
          </Text>
        </MoneyCard>

        <SectionHeader title="Your data" />
        <DataSection {...data} />
      </View>
    </ScrollView>
  );
};
