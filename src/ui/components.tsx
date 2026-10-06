import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, Pressable, TextInput, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, bg, ink } from './theme';
import { useInk } from './kit';
import { PressableScale } from './press';
import { SPRING } from './motion/tokens';
import { canMove } from './motion/useMotion';
import { feel } from './motion/runtime';

export const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text className={`${t.label} mb-2`}>{children}</Text>
);

/** A choice among several. The one just chosen snaps into place, with a light tap. */
export const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => {
  const snap = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (selected && canMove('fade')) {
      snap.setValue(0.93);
      Animated.spring(snap, { toValue: 1, useNativeDriver: true, ...SPRING.snap }).start();
    }
  }, [selected, snap]);

  return (
    <Animated.View style={{ transform: [{ scale: snap }] }}>
      <Pressable
        onPress={() => {
          if (!selected) feel.haptic('light');
          onPress();
        }}
        className={`rounded-full border px-3.5 py-2 ${
          selected
            ? 'border-textPrimary dark:border-textPrimary-dark bg-textPrimary dark:bg-textPrimary-dark'
            : 'border-border dark:border-border-dark bg-surface dark:bg-surface-dark'
        }`}
      >
        <Text
          className={`text-[13px] ${
            selected ? 'font-semibold text-background dark:text-background-dark' : ink.secondary
          }`}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

export const ChipRow = <T extends string>({
  options,
  value,
  onChange,
  labelFor = (option) => option,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelFor?: (option: T) => string;
}) => (
  <View className="flex-row flex-wrap gap-2">
    {options.map((option) => (
      <Chip
        key={option}
        label={labelFor(option)}
        selected={option === value}
        onPress={() => onChange(option)}
      />
    ))}
  </View>
);

export const Field: React.FC<{
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  numeric?: boolean;
  prefix?: string;
  /** Hides what is typed, for passphrases. */
  secure?: boolean;
}> = ({ label, value, onChangeText, placeholder, numeric, prefix, secure }) => {
  const { colors } = useInk();
  return (
    <View>
      <Label>{label}</Label>
      <View className={`${t.input} flex-row items-center`}>
        {prefix && <Text className={`${t.muted} mr-1.5`}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          keyboardType={numeric ? 'decimal-pad' : 'default'}
          secureTextEntry={secure}
          autoCapitalize={secure ? 'none' : undefined}
          autoCorrect={secure ? false : undefined}
          className={`flex-1 text-[15px] ${ink.primary}`}
        />
      </View>
    </View>
  );
};

export const ErrorText: React.FC<{ message?: string }> = ({ message }) =>
  message ? <Text className={`text-[13px] ${ink.negative}`}>{message}</Text> : null;

export const PrimaryButton: React.FC<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
}> = ({ label, onPress, disabled }) => (
  <PressableScale
    onPress={onPress}
    haptic="light"
    disabled={disabled}
    accessibilityRole="button"
    accessibilityState={{ disabled: !!disabled }}
    scale={0.98}
    className={disabled ? `rounded-2xl ${bg.muted} py-4` : t.primaryButton}
  >
    <Text className={disabled ? `text-center text-[15px] font-medium ${ink.tertiary}` : t.primaryLabel}>
      {label}
    </Text>
  </PressableScale>
);

export const GhostButton: React.FC<{ label: string; onPress: () => void }> = ({
  label,
  onPress,
}) => (
  <PressableScale onPress={onPress} accessibilityRole="button" scale={0.98} className={t.ghostButton}>
    <Text className={t.ghostLabel}>{label}</Text>
  </PressableScale>
);

/** A small stat: a faint caption over a value. */
export const Stat: React.FC<{ caption: string; value: string; note?: string }> = ({
  caption,
  value,
  note,
}) => (
  <View className="flex-1">
    <Text className={t.faint}>{caption}</Text>
    <Text className={`${t.amount} mt-1`}>{value}</Text>
    {note && <Text className={`${t.faint} mt-0.5`}>{note}</Text>}
  </View>
);

/**
 * The panel of a bottom sheet. Android draws edge to edge, so the
 * panel pads itself clear of the navigation bar — 3-button or gesture, the
 * height is measured, not guessed.
 */
export const SheetBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`rounded-t-3xl ${bg.surface} px-5 pt-3 ${className}`}
      style={{ paddingBottom: insets.bottom + 24 }}
    >
      {/* The grab handle: says "this slides". */}
      <View className={`mb-4 h-1 w-10 self-center rounded-full ${bg.muted}`} />
      {children}
    </View>
  );
};

/**
 * The dimmed backdrop of a bottom sheet. It rises with the keyboard, so the
 * field being typed in stays in sight. Tapping the dim area calls `onClose`.
 */
export const SheetOverlay: React.FC<{ children: React.ReactNode; onClose?: () => void }> = ({
  children,
  onClose,
}) => (
  <KeyboardAvoidingView
    behavior="padding"
    style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
  >
    {onClose && <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />}
    {children}
  </KeyboardAvoidingView>
);
