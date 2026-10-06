import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Animated, Easing, Keyboard, Pressable, StyleSheet } from 'react-native';
import { paise, subtract, type Paise } from '@/money/money';
import { t, bg, ink, line } from './theme';
import { Icon, useAmount, useInk, type IconName } from './kit';
import { PressableScale } from './press';
import { SheetBody, SheetOverlay, GhostButton } from './components';
import { useCounted } from './motion/AmountTransition';
import { canMove } from './motion/useMotion';
import { useAnchor } from './motion/anchors';
import { DURATION, EASE, SCALE, SPRING } from './motion/tokens';

/**
 * The small set of pieces every screen is built from, so Home, Reports and
 * Budgets read as one product. Nothing here knows about the ledger: a screen
 * hands it figures it already has.
 */

// ------------------------------------------------------------------ amounts

export type AmountSize = 'hero' | 'display' | 'figure' | 'body' | 'small';
export type AmountTone = 'neutral' | 'auto' | 'positive' | 'negative' | 'muted';

const AMOUNT_SIZE: Record<AmountSize, { fontSize: number; fontWeight: '700' | '600' | '500'; letterSpacing?: number }> = {
  hero: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8 },
  figure: { fontSize: 24, fontWeight: '600', letterSpacing: -0.4 },
  body: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '500' },
};

/**
 * Money as text: always through the shared formatter, so the hide-amounts eye
 * works and no screen builds "Rs " strings by hand. `signed` shows a + or −
 * and the size of the amount; `tone: 'auto'` colours by direction.
 */
export const Amount: React.FC<{
  value: Paise;
  size?: AmountSize;
  tone?: AmountTone;
  signed?: boolean;
  paise?: boolean;
  numberOfLines?: number;
  /** Shrinks the text to fit one line instead of cutting it off. */
  fit?: boolean;
  /**
   * Counts to a new value instead of snapping to it. For the figures a person watches
   * (wealth, safe to spend, this month), not for rows in a list.
   */
  animate?: boolean;
}> = ({ value, size = 'body', tone = 'neutral', signed, paise: withPaise, numberOfLines, fit, animate }) => {
  const show = useAmount();
  const { colors } = useInk();
  const counted = useCounted(value, { enabled: !!animate }).shown;
  const incoming = value > 0;
  const color =
    tone === 'positive' ? colors.positive
    : tone === 'negative' ? colors.negative
    : tone === 'muted' ? colors.textSecondary
    : tone === 'auto' ? (value === 0 ? colors.textPrimary : incoming ? colors.positive : colors.negative)
    : colors.textPrimary;
  const figure = paise(counted);
  const shown = signed && value < 0 ? subtract(paise(0), figure) : figure;
  return (
    <Text
      numberOfLines={fit ? 1 : numberOfLines}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.6 : undefined}
      style={{ ...AMOUNT_SIZE[size], color }}
    >
      {signed && value !== 0 ? (incoming ? '+' : '−') : ''}
      {show(shown, { paise: withPaise })}
    </Text>
  );
};

// ------------------------------------------------------------------ headings

export const ScreenHeader: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}> = ({ title, subtitle, right }) => (
  <View className="flex-row items-end justify-between px-5 pb-3 pt-6">
    <View className="flex-1 pr-3">
      <Text className={t.title}>{title}</Text>
      {subtitle && <Text className={`${t.muted} mt-1.5 leading-5`}>{subtitle}</Text>}
    </View>
    {right}
  </View>
);

export const SectionHeader: React.FC<{
  title: string;
  action?: { label: string; onPress: () => void };
}> = ({ title, action }) => (
  <View className="flex-row items-center justify-between pb-3 pt-2">
    <Text className={`text-[18px] font-semibold ${ink.primary}`}>{title}</Text>
    {action && (
      <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
        <Text className={`text-[13px] font-medium ${ink.accent}`}>{action.label}</Text>
      </Pressable>
    )}
  </View>
);

// --------------------------------------------------------------------- cards

/**
 * A surface that sits on the page. Pass `onPress` and it becomes a button
 * that gives under the finger. `flat` drops the hairline edge, for a card that
 * already has plenty inside it.
 */
export const MoneyCard: React.FC<{
  children: React.ReactNode;
  onPress?: () => void;
  flat?: boolean;
  /** Spacing below, in points; 16 by default so cards stack evenly. */
  gap?: number;
  padded?: boolean;
  accessibilityLabel?: string;
  /** A name the motion layer can find this card by, to send money to it. */
  anchor?: string;
}> = ({ children, onPress, flat, gap = 16, padded = true, accessibilityLabel, anchor }) => {
  const look = `${flat ? t.cardFlat : t.card} ${padded ? '' : 'p-0'}`;
  const ref = useAnchor(anchor);
  if (!onPress) {
    return (
      <View ref={ref} collapsable={false} className={look} style={{ marginBottom: gap }}>
        {children}
      </View>
    );
  }
  return (
    <View ref={ref} collapsable={false} style={{ marginBottom: gap }}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        scale={0.985}
        remember
        className={look}
      >
        {children}
      </PressableScale>
    </View>
  );
};

/**
 * One finding, with what it rests on. Never a recommendation: the eyebrow
 * names what kind of change it is, the headline says what happened, and the
 * children carry the evidence (before and after, the entries behind it).
 */
export const InsightCard: React.FC<{
  eyebrow: string;
  icon?: string;
  headline: string;
  children?: React.ReactNode;
  action?: { label: string; onPress: () => void };
  gap?: number;
}> = ({ eyebrow, icon = '✨', headline, children, action, gap = 12 }) => (
  <View className={t.card} style={{ marginBottom: gap }}>
    <View className="flex-row items-center">
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <Text className={`${t.label} ml-1.5`}>{eyebrow}</Text>
    </View>
    <Text className={`mt-2.5 text-[17px] font-semibold leading-6 ${ink.primary}`}>{headline}</Text>
    {children}
    {action && (
      <Pressable onPress={action.onPress} hitSlop={8} className="mt-3 self-start" accessibilityRole="button">
        <Text className={`text-[14px] font-semibold ${ink.accent}`}>{action.label} →</Text>
      </Pressable>
    )}
  </View>
);

/**
 * A place money sits. A balance nobody has told us is shown as unknown, never
 * as zero: `amount` left undefined says so in words.
 */
export const AccountRow: React.FC<{
  icon: IconName;
  title: string;
  subtitle?: string;
  /** A second, fainter line: where the figure comes from and how fresh it is. */
  detail?: string;
  amount?: Paise;
  /** Shown instead of a figure when the balance is not known. */
  unknownLabel?: string;
  onPress?: () => void;
}> = ({ icon, title, subtitle, detail, amount, unknownLabel = 'Balance not known', onPress }) => {
  const { colors } = useInk();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={{ color: colors.surfaceMuted }}
      className="flex-row items-center py-3.5"
    >
      <View className={`h-11 w-11 items-center justify-center rounded-2xl ${bg.muted}`}>
        <Icon name={icon} size={22} />
      </View>
      <View className="ml-3 flex-1 pr-2">
        <Text className={`text-[15px] font-semibold ${ink.primary}`} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className={`${t.faint} mt-0.5`} numberOfLines={1}>{subtitle}</Text> : null}
        {detail ? <Text className={`${t.faint} mt-0.5`} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {amount === undefined ? (
        <Text className={`text-[13px] ${ink.tertiary}`}>{unknownLabel}</Text>
      ) : (
        <Amount value={amount} size="body" />
      )}
    </Pressable>
  );
};

/** A compact button for inside a card: filled for the main answer, outlined for the other. */
export const SmallButton: React.FC<{ label: string; onPress: () => void; outline?: boolean; disabled?: boolean; flex?: boolean }> = ({
  label,
  onPress,
  outline,
  disabled,
  flex = true,
}) => (
  <PressableScale
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    scale={0.97}
    style={flex ? { flex: 1 } : undefined}
    className={outline ? `rounded-xl border ${line.border} py-2.5` : disabled ? `rounded-xl ${bg.muted} py-2.5` : `rounded-xl ${bg.accent} py-2.5`}
  >
    <Text className={`text-center text-[14px] font-semibold ${outline ? ink.primary : disabled ? ink.tertiary : ink.onAccent}`}>{label}</Text>
  </PressableScale>
);

// ------------------------------------------------------------------ progress

/**
 * A bar that fills as it appears and again when the figure moves. `value` is
 * a whole percent (over 100 is capped); `marker` puts a tick where an even
 * pace would have got to.
 */
export const ProgressBar: React.FC<{
  value: number;
  tone?: 'accent' | 'negative' | 'neutral';
  height?: number;
  marker?: number;
}> = ({ value, tone = 'accent', height = 8, marker }) => {
  const { colors } = useInk();
  const width = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, value));

  useEffect(() => {
    Animated.timing(width, {
      toValue: clamped,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clamped, width]);

  const fill = tone === 'negative' ? colors.negative : tone === 'neutral' ? colors.textPrimary : colors.accent;
  return (
    <View style={{ height }}>
      <View style={{ height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
        <Animated.View
          style={{
            height,
            borderRadius: height / 2,
            backgroundColor: fill,
            width: width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
          }}
        />
      </View>
      {marker !== undefined && (
        <View
          style={{
            position: 'absolute',
            top: -3,
            height: height + 6,
            width: 2,
            borderRadius: 1,
            left: `${Math.max(0, Math.min(100, marker))}%`,
            backgroundColor: colors.textTertiary,
          }}
        />
      )}
    </View>
  );
};

// ------------------------------------------------------------------ controls

/** A row of options, one chosen: All / Income / Expense. */
export const SegmentedControl = <T extends string>({
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
  <View className={`flex-row rounded-full ${bg.muted} p-1`}>
    {options.map((option) => {
      const on = option === value;
      return (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
          className={`flex-1 items-center rounded-full py-2 ${on ? 'bg-textPrimary dark:bg-textPrimary-dark' : ''}`}
        >
          <Text
            numberOfLines={1}
            className={`text-[13px] ${on ? 'font-semibold text-background dark:text-background-dark' : `font-medium ${ink.secondary}`}`}
          >
            {labelFor(option)}
          </Text>
        </Pressable>
      );
    })}
  </View>
);

export const IconButton: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  filled?: boolean;
}> = ({ icon, label, onPress, size = 42, filled }) => {
  const { colors } = useInk();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scale={0.92}
      className={`items-center justify-center rounded-full ${filled ? bg.accent : `border ${line.border} ${bg.surface}`}`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={size * 0.5} color={filled ? colors.onAccent : colors.textPrimary} />
    </PressableScale>
  );
};

// ------------------------------------------------------------- empty / error

/** Says what will appear here and when, instead of "No data". */
export const EmptyState: React.FC<{
  icon?: string;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}> = ({ icon, title, body, action }) => (
  <View className="items-center px-6 py-10">
    {icon ? (
      <View className={`mb-4 h-14 w-14 items-center justify-center rounded-full ${bg.muted}`}>
        <Text style={{ fontSize: 24 }}>{icon}</Text>
      </View>
    ) : null}
    <Text className={`text-center text-[17px] font-semibold ${ink.primary}`}>{title}</Text>
    <Text className={`${t.muted} mt-2 text-center leading-5`}>{body}</Text>
    {action && (
      <View className="mt-5 self-stretch">
        <GhostButton label={action.label} onPress={action.onPress} />
      </View>
    )}
  </View>
);

// ------------------------------------------------------------------ loading

/** A quiet grey block that breathes, standing in for text or a figure. */
export const Skeleton: React.FC<{ width?: number | `${number}%`; height?: number; radius?: number }> = ({
  width = '100%',
  height = 14,
  radius = 8,
}) => {
  const { colors } = useInk();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted, opacity: pulse }} />;
};

/** The shape of a screen before its data arrives: a headline figure, a card, a few rows. */
export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <View className="px-5 pt-8" accessibilityLabel="Loading">
    <Skeleton width={120} height={12} />
    <View style={{ height: 12 }} />
    <Skeleton width={220} height={40} radius={12} />
    <View style={{ height: 28 }} />
    <View className={t.card}>
      <Skeleton width="45%" height={12} />
      <View style={{ height: 12 }} />
      <Skeleton width="70%" height={28} radius={10} />
      <View style={{ height: 16 }} />
      <Skeleton height={8} radius={4} />
    </View>
    <View style={{ height: 16 }} />
    {Array.from({ length: rows }, (_, i) => (
      <View key={i} className="flex-row items-center py-3">
        <Skeleton width={42} height={42} radius={14} />
        <View className="ml-3 flex-1">
          <Skeleton width="55%" height={14} />
          <View style={{ height: 8 }} />
          <Skeleton width="35%" height={11} />
        </View>
        <Skeleton width={56} height={14} />
      </View>
    ))}
  </View>
);

// -------------------------------------------------------------------- sheets

/** A panel that slides up over the screen; tapping outside it, or Back, closes it. */
export const BottomSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}> = ({ visible, onClose, title, children }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <SheetOverlay onClose={onClose}>
      <SheetBody>
        {title ? <Text className={`${t.section} mb-4`}>{title}</Text> : null}
        {children}
      </SheetBody>
    </SheetOverlay>
  </Modal>
);

// ------------------------------------------------------------------- tab bar

export type NavTab<T extends string> = { key: T; label: string; icon: IconName };

const PILL_W = 52;
const PILL_H = 30;
const SLIDE = Easing.bezier(...EASE.out);

/** One tab. On being chosen its icon settles in from a hair smaller and its label brightens. */
const TabItem: React.FC<{
  label: string;
  icon: IconName;
  on: boolean;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
}> = ({ label, icon, on, onPress, onLayout }) => {
  const { colors } = useInk();
  const arrive = useRef(new Animated.Value(on ? 1 : 0)).current;
  const first = useRef(true);
  const tone = on ? colors.textPrimary : colors.textTertiary;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (on && canMove('fade')) {
      arrive.setValue(0);
      Animated.spring(arrive, { toValue: 1, useNativeDriver: true, ...SPRING.snap }).start();
    } else {
      arrive.setValue(on ? 1 : 0);
    }
  }, [on, arrive]);

  return (
    <Pressable
      onPress={onPress}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}
    >
      <View style={{ width: PILL_W, height: PILL_H, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ transform: [{ scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [SCALE.tab, 1] }) }] }}>
          <Icon name={icon} size={22} color={tone} />
        </Animated.View>
      </View>
      <Animated.Text
        style={{
          fontSize: 11,
          marginTop: 2,
          fontWeight: on ? '700' : '500',
          color: tone,
          opacity: on ? arrive.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1], extrapolate: 'clamp' }) : 1,
        }}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
};

/**
 * Home, Activity, a raised "+" in the middle, Reports, More. The current tab
 * is marked by a soft pill that slides to it; the bar steps aside for the keyboard.
 */
export const AppTabBar = <T extends string>({
  tabs,
  current,
  onChange,
  onAdd,
}: {
  /** Four tabs: two either side of the "+". */
  tabs: NavTab<T>[];
  current: T;
  onChange: (tab: T) => void;
  onAdd: () => void;
}) => {
  const { colors } = useInk();
  const [typing, setTyping] = useState(false);
  const [places, setPlaces] = useState<Record<string, number>>({});
  const slide = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Where the pill belongs: centred on the current tab, once that tab has been measured.
  const target = places[current];
  useEffect(() => {
    if (target === undefined) return;
    if (!placed.current || !canMove('fade')) {
      placed.current = true;
      slide.setValue(target);
      return;
    }
    Animated.timing(slide, { toValue: target, duration: DURATION.micro.tab, easing: SLIDE, useNativeDriver: true }).start();
  }, [target, slide, typing]);

  if (typing) return null;

  const tab = (item: NavTab<T>) => (
    <TabItem
      key={item.key}
      label={item.label}
      icon={item.icon}
      on={item.key === current}
      onPress={() => onChange(item.key)}
      onLayout={(x, width) => {
        const center = x + (width - PILL_W) / 2;
        setPlaces((seen) => (seen[item.key] === center ? seen : { ...seen, [item.key]: center }));
      }}
    />
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 6,
        backgroundColor: colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      {target !== undefined && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 12,
            width: PILL_W,
            height: PILL_H,
            borderRadius: PILL_H / 2,
            backgroundColor: colors.surfaceMuted,
            transform: [{ translateX: slide }],
          }}
        />
      )}
      {tabs.slice(0, 2).map(tab)}
      <View style={{ width: 84, alignItems: 'center' }}>
        <PressableScale
          onPress={onAdd}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel="Add"
          scale={0.9}
          className="items-center justify-center"
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.accent,
            shadowColor: '#000',
            shadowOpacity: 0.22,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={28} color={colors.onAccent} />
          </View>
        </PressableScale>
      </View>
      {tabs.slice(2).map(tab)}
    </View>
  );
};

// ----------------------------------------------------------------- add sheet

export type AddKind = 'expense' | 'income' | 'transfer' | 'purchase';

const ADD_CHOICES: Array<{ kind: AddKind; title: string; note: string; symbol: string }> = [
  { kind: 'expense', title: 'Expense', note: 'Money you spent', symbol: '↑' },
  { kind: 'income', title: 'Income', note: 'Salary or money that came in', symbol: '↓' },
  { kind: 'transfer', title: 'Transfer', note: 'Between your own accounts', symbol: '⇄' },
  { kind: 'purchase', title: 'Purchase', note: 'Items you bought, with their prices', symbol: '🛒' },
];

/** "What do you want to add?" — one tap to the right form, Expense first. */
export const AddSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onPick: (kind: AddKind) => void;
}> = ({ visible, onClose, onPick }) => {
  const { colors } = useInk();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="What do you want to add?">
      <View className="gap-2.5">
        {ADD_CHOICES.map((choice, index) => {
          const primary = index === 0;
          return (
            <PressableScale
              key={choice.kind}
              onPress={() => onPick(choice.kind)}
              accessibilityRole="button"
              scale={0.98}
              className={`flex-row items-center rounded-2xl px-4 py-3.5 ${primary ? bg.accent : `border ${line.border} ${bg.surface}`}`}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: primary ? 'rgba(255,255,255,0.2)' : colors.surfaceMuted,
                }}
              >
                <Text style={{ fontSize: 18, fontWeight: '700', color: primary ? colors.onAccent : colors.textPrimary }}>
                  {choice.symbol}
                </Text>
              </View>
              <View className="ml-3 flex-1">
                <Text className={`text-[16px] font-semibold ${primary ? ink.onAccent : ink.primary}`}>{choice.title}</Text>
                <Text className={`mt-0.5 text-[12px] ${primary ? ink.onAccent : ink.tertiary}`} style={primary ? { opacity: 0.8 } : undefined}>
                  {choice.note}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </View>
    </BottomSheet>
  );
};
