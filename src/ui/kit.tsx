import React, { useRef } from 'react';
import { View, Text, Pressable, type ViewStyle } from 'react-native';
import { useColorScheme } from 'nativewind';
import { subtract, paise, type Paise } from '@/money/money';
import { rupees } from '@/lib/rupees';
import { useLedger } from './store';
import { colorsFor } from './theme';
import { noteOrigin } from './motion/origin';

/**
 * Reads the current theme for the handful of places a className can't reach:
 * native style props, icon colours. `colors` is the whole semantic palette.
 */
export const useInk = () => {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';
  const colors = colorsFor(dark);
  return { dark, colors, ink: colors.textPrimary, page: colors.background };
};

/**
 * Line icons drawn in the primary text colour, and a wealth figure that can
 * be hidden from people nearby.
 */

// ------------------------------------------------------------------ amounts

export { rupees };

export const MASK = '₹ • • • • •';

/** Formats money, or hides it when the user has tapped the eye. */
export const useAmount = () => {
  const hidden = useLedger((s) => s.hideAmounts);
  return (amount: Paise, options: { paise?: boolean } = {}) => (hidden ? MASK : rupees(amount, options));
};

// -------------------------------------------------------------------- icons

export type IconName =
  | 'home' | 'activity' | 'items' | 'wallet' | 'search' | 'lock' | 'eye' | 'eyeOff'
  | 'bank' | 'funds' | 'stocks' | 'cash' | 'safe' | 'user' | 'chevron' | 'up' | 'down'
  | 'plus' | 'reports' | 'more' | 'close' | 'check' | 'back';

const line = (color: string, w: number): ViewStyle => ({ borderColor: color, borderWidth: w });

/**
 * Line icons drawn with plain views, so no icon font or SVG library is
 * needed. Each fits a square of `size`.
 */
export const Icon: React.FC<{ name: IconName; size?: number; color?: string }> = ({
  name,
  size = 24,
  color,
}) => {
  const { ink, page } = useInk();
  color = color ?? ink;
  const s = size;
  const w = Math.max(1.5, s / 14);
  const box: ViewStyle = { width: s, height: s, alignItems: 'center', justifyContent: 'center' };

  switch (name) {
    case 'home':
      return (
        <View style={box}>
          <View style={{ width: s * 0.5, height: s * 0.5, ...line(color, w), borderBottomWidth: 0, borderRightWidth: 0, transform: [{ rotate: '45deg' }], position: 'absolute', top: s * 0.14 }} />
          <View style={{ width: s * 0.58, height: s * 0.42, ...line(color, w), borderTopWidth: 0, position: 'absolute', bottom: s * 0.12 }} />
        </View>
      );
    case 'activity':
      return (
        <View style={[box, { gap: s * 0.14 }]}>
          {[0.7, 0.5, 0.7].map((f, i) => (
            <View key={i} style={{ width: s * f, height: w, backgroundColor: color, borderRadius: w, alignSelf: i === 1 ? 'flex-start' : 'center', marginLeft: i === 1 ? s * 0.15 : 0 }} />
          ))}
        </View>
      );
    case 'items':
      return (
        <View style={box}>
          <View style={{ width: s * 0.32, height: s * 0.24, ...line(color, w), borderBottomWidth: 0, borderTopLeftRadius: s, borderTopRightRadius: s, position: 'absolute', top: s * 0.1 }} />
          <View style={{ width: s * 0.66, height: s * 0.52, ...line(color, w), borderRadius: s * 0.08, position: 'absolute', bottom: s * 0.12 }} />
        </View>
      );
    case 'wallet':
      return (
        <View style={box}>
          <View style={{ width: s * 0.74, height: s * 0.56, ...line(color, w), borderRadius: s * 0.1 }} />
          <View style={{ width: s * 0.22, height: s * 0.2, ...line(color, w), borderRadius: s * 0.04, position: 'absolute', right: s * 0.13 }} />
        </View>
      );
    case 'search':
      return (
        <View style={box}>
          <View style={{ width: s * 0.5, height: s * 0.5, ...line(color, w), borderRadius: s, position: 'absolute', top: s * 0.12, left: s * 0.12 }} />
          <View style={{ width: s * 0.26, height: w * 1.1, backgroundColor: color, borderRadius: w, position: 'absolute', bottom: s * 0.2, right: s * 0.1, transform: [{ rotate: '45deg' }] }} />
        </View>
      );
    case 'lock':
      return (
        <View style={box}>
          <View style={{ width: s * 0.38, height: s * 0.34, ...line(color, w), borderBottomWidth: 0, borderTopLeftRadius: s, borderTopRightRadius: s, position: 'absolute', top: s * 0.12 }} />
          <View style={{ width: s * 0.6, height: s * 0.42, backgroundColor: color, borderRadius: s * 0.08, position: 'absolute', bottom: s * 0.12 }} />
        </View>
      );
    case 'eye':
    case 'eyeOff':
      return (
        <View style={box}>
          <View style={{ width: s * 0.8, height: s * 0.46, ...line(color, w), borderRadius: s }} />
          <View style={{ width: s * 0.2, height: s * 0.2, backgroundColor: color, borderRadius: s, position: 'absolute' }} />
          {name === 'eyeOff' && (
            <View style={{ width: s * 0.9, height: w, backgroundColor: color, position: 'absolute', transform: [{ rotate: '-35deg' }] }} />
          )}
        </View>
      );
    case 'bank':
      return (
        <View style={box}>
          <View style={{ width: 0, height: 0, borderLeftWidth: s * 0.4, borderRightWidth: s * 0.4, borderBottomWidth: s * 0.22, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color, position: 'absolute', top: s * 0.08 }} />
          <View style={{ flexDirection: 'row', gap: s * 0.12, position: 'absolute', top: s * 0.36 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: w, height: s * 0.34, backgroundColor: color }} />
            ))}
          </View>
          <View style={{ width: s * 0.8, height: w * 1.2, backgroundColor: color, position: 'absolute', bottom: s * 0.1 }} />
        </View>
      );
    case 'funds':
      return (
        <View style={[box, { flexDirection: 'row', alignItems: 'flex-end', gap: s * 0.08, paddingBottom: s * 0.12 }]}>
          {[0.3, 0.5, 0.72].map((h, i) => (
            <View key={i} style={{ width: s * 0.18, height: s * h, ...line(color, w), borderRadius: s * 0.04 }} />
          ))}
        </View>
      );
    case 'stocks':
      return (
        <View style={[box, { flexDirection: 'row', gap: s * 0.14 }]}>
          {[
            [0.1, 0.36],
            [0.24, 0.28],
            [0.06, 0.4],
          ].map(([top, h], i) => (
            <View key={i} style={{ alignItems: 'center', height: s * 0.8, width: s * 0.16 }}>
              <View style={{ width: w, height: s * 0.8, backgroundColor: color, position: 'absolute' }} />
              <View style={{ width: s * 0.16, height: s * h, marginTop: s * top, ...line(color, w), backgroundColor: page, borderRadius: s * 0.03 }} />
            </View>
          ))}
        </View>
      );
    case 'cash':
      return (
        <View style={box}>
          <View style={{ width: s * 0.84, height: s * 0.5, ...line(color, w), borderRadius: s * 0.06 }} />
          <View style={{ width: s * 0.2, height: s * 0.2, ...line(color, w), borderRadius: s, position: 'absolute' }} />
        </View>
      );
    case 'safe':
      return (
        <View style={box}>
          <View style={{ width: s * 0.74, height: s * 0.7, ...line(color, w), borderRadius: s * 0.1 }} />
          <View style={{ width: s * 0.3, height: s * 0.3, ...line(color, w), borderRadius: s, position: 'absolute' }} />
        </View>
      );
    case 'user':
      return (
        <View style={box}>
          <View style={{ width: s * 0.34, height: s * 0.34, backgroundColor: color, borderRadius: s, position: 'absolute', top: s * 0.14 }} />
          <View style={{ width: s * 0.62, height: s * 0.3, backgroundColor: color, borderTopLeftRadius: s, borderTopRightRadius: s, position: 'absolute', bottom: s * 0.12 }} />
        </View>
      );
    case 'chevron':
      return (
        <View style={box}>
          <View style={{ width: s * 0.3, height: s * 0.3, ...line(color, w), borderLeftWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '45deg' }], marginRight: s * 0.12 }} />
        </View>
      );
    case 'up':
    case 'down':
      return (
        <View style={[box, { transform: [{ rotate: name === 'down' ? '180deg' : '0deg' }] }]}>
          <View style={{ width: w, height: s * 0.6, backgroundColor: color, position: 'absolute', bottom: s * 0.15 }} />
          <View style={{ width: s * 0.36, height: s * 0.36, ...line(color, w), borderRightWidth: 0, borderBottomWidth: 0, transform: [{ rotate: '45deg' }], position: 'absolute', top: s * 0.2 }} />
        </View>
      );
    case 'plus':
      return (
        <View style={box}>
          <View style={{ width: s * 0.6, height: w * 1.4, backgroundColor: color, borderRadius: w, position: 'absolute' }} />
          <View style={{ width: w * 1.4, height: s * 0.6, backgroundColor: color, borderRadius: w, position: 'absolute' }} />
        </View>
      );
    case 'reports':
      return (
        <View style={[box, { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: s * 0.1, paddingBottom: s * 0.14 }]}>
          {[0.36, 0.6, 0.46, 0.74].map((h, i) => (
            <View key={i} style={{ width: s * 0.13, height: s * h, backgroundColor: color, borderRadius: s * 0.04 }} />
          ))}
        </View>
      );
    case 'more':
      return (
        <View style={[box, { flexDirection: 'row', gap: s * 0.1 }]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: s * 0.14, height: s * 0.14, borderRadius: s, backgroundColor: color }} />
          ))}
        </View>
      );
    case 'close':
      return (
        <View style={box}>
          {[45, -45].map((deg) => (
            <View key={deg} style={{ width: s * 0.66, height: w * 1.3, backgroundColor: color, borderRadius: w, position: 'absolute', transform: [{ rotate: `${deg}deg` }] }} />
          ))}
        </View>
      );
    case 'check':
      return (
        <View style={box}>
          <View style={{ width: s * 0.28, height: s * 0.5, ...line(color, w * 1.3), borderTopWidth: 0, borderLeftWidth: 0, transform: [{ rotate: '40deg' }], marginBottom: s * 0.08 }} />
        </View>
      );
    case 'back':
      return (
        <View style={box}>
          <View style={{ width: s * 0.36, height: s * 0.36, ...line(color, w * 1.2), borderRightWidth: 0, borderTopWidth: 0, transform: [{ rotate: '45deg' }], marginLeft: s * 0.12 }} />
        </View>
      );
  }
};

// ------------------------------------------------------------ categories

/**
 * Each category's chip: a symbol on its own tint (Paisa's scheme, from
 * design.md). Emoji need no icon library and read at a glance.
 */
const CATEGORY_LOOK: Record<string, { symbol: string; tint: string; ink: string }> = {
  'Food & Dining': { symbol: '🍔', tint: '#FDE2E0', ink: '#E5484D' },
  Groceries: { symbol: '🛒', tint: '#DCEBFE', ink: '#2F6FEB' },
  Transport: { symbol: '🚗', tint: '#DDF3E4', ink: '#2F9E5B' },
  Utilities: { symbol: '💡', tint: '#FDF1C7', ink: '#C99400' },
  Entertainment: { symbol: '🎮', tint: '#EDE3FD', ink: '#7C4DDB' },
  Shopping: { symbol: '🛍️', tint: '#DCEBFE', ink: '#2F6FEB' },
  Healthcare: { symbol: '➕', tint: '#D7F2EF', ink: '#159A8C' },
  Education: { symbol: '🎓', tint: '#FDF1C7', ink: '#C99400' },
  Investment: { symbol: '📈', tint: '#DDF3E4', ink: '#2F9E5B' },
  Subscriptions: { symbol: '🔁', tint: '#EDE3FD', ink: '#7C4DDB' },
  Transfers: { symbol: '⇄', tint: '#ECECEA', ink: '#525252' },
  'Fees & Charges': { symbol: '💳', tint: '#FDE2E0', ink: '#E5484D' },
  Unknown: { symbol: '?', tint: '#ECECEA', ink: '#737373' },
  Salary: { symbol: '💼', tint: '#D7F2EF', ink: '#159A8C' },
  Bills: { symbol: '📄', tint: '#DCEBFE', ink: '#2F6FEB' },
  Family: { symbol: '👪', tint: '#D7F2EF', ink: '#159A8C' },
  Society: { symbol: '🏢', tint: '#EDE3FD', ink: '#7C4DDB' },
  Kheti: { symbol: '🌾', tint: '#F3E6D6', ink: '#9A6B3C' },
  Waste: { symbol: '🗑️', tint: '#FDF1C7', ink: '#C99400' },
  Savings: { symbol: '🐷', tint: '#FDE2EC', ink: '#D6457A' },
};

/** A category's chip fill: its pastel tint, or the same hue at low opacity on a dark page. */
export const categoryTint = (look: { tint: string; ink: string }, dark: boolean): string =>
  dark ? `${look.ink}30` : look.tint;

export const categoryLook = (name: string) =>
  CATEGORY_LOOK[name] ?? { symbol: name.trim().charAt(0).toUpperCase() || '?', tint: '#ECECEA', ink: '#525252' };

export const CategoryChip: React.FC<{ name: string; size?: number }> = ({ name, size = 42 }) => {
  const look = categoryLook(name);
  const { dark } = useInk();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: categoryTint(look, dark),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.46, color: look.ink, fontWeight: '700' }}>{look.symbol}</Text>
    </View>
  );
};

/** Categories whose money is neither spent nor earned: shown neutral, not red or green. */
const NEUTRAL_CATEGORIES = new Set(['Transfers', 'Investment', 'Savings']);

/** One transaction, as every list shows it: chip, name, details, amount. */
export const TxRow: React.FC<{
  title: string;
  category: string;
  detail?: string;
  amount: Paise;
  onPress?: () => void;
}> = ({ title, category, detail, amount, onPress }) => {
  const show = useAmount();
  const { colors } = useInk();
  const incoming = amount > 0;
  const neutral = NEUTRAL_CATEGORIES.has(category);
  const tone = neutral ? colors.textPrimary : incoming ? colors.positive : colors.negative;
  const box = useRef<View>(null);
  return (
    <Pressable
      ref={box}
      onPressIn={() => box.current?.measureInWindow((x, y, width, height) => noteOrigin({ x, y, width, height }))}
      onPress={onPress}
      android_ripple={{ color: colors.surfaceMuted }}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11 }}
    >
      <CategoryChip name={category} />
      <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }} numberOfLines={1}>
          {detail ? `${category} · ${detail}` : category}
        </Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: '700', color: tone }}>
        {incoming ? '+' : '−'}
        {show(incoming ? amount : subtract(paise(0), amount))}
      </Text>
    </Pressable>
  );
};

/** Room at the bottom of a scrolling screen, so its last row clears the edge. */
export const TAB_BAR_SPACE = 40;
