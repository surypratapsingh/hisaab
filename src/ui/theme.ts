import { palette, type Colors } from './palette';

/**
 * The visual vocabulary, kept in one place so the screens stay consistent.
 *
 * Neutral surfaces carry the app; colour is spent where it means something:
 * green for money in, red for money out, an accent on the one main action of
 * a screen, and a category's own tint on its icon. The values live in
 * palette.js (light and dark side by side) and reach a className through the
 * semantic names Tailwind is given there ("bg-surface dark:bg-surface-dark").
 */

/** The current theme's raw colours, for native style props a className cannot reach. */
export const colorsFor = (dark: boolean): Colors => (dark ? palette.dark : palette.light);

/** Backgrounds. Tailwind only sees whole class names, so each is spelled out. */
export const bg = {
  page: 'bg-background dark:bg-background-dark',
  surface: 'bg-surface dark:bg-surface-dark',
  raised: 'bg-surfaceElevated dark:bg-surfaceElevated-dark',
  muted: 'bg-surfaceMuted dark:bg-surfaceMuted-dark',
  accent: 'bg-accent dark:bg-accent-dark',
} as const;

/** Text colours. */
export const ink = {
  primary: 'text-textPrimary dark:text-textPrimary-dark',
  secondary: 'text-textSecondary dark:text-textSecondary-dark',
  tertiary: 'text-textTertiary dark:text-textTertiary-dark',
  positive: 'text-positive dark:text-positive-dark',
  negative: 'text-negative dark:text-negative-dark',
  warning: 'text-warning dark:text-warning-dark',
  accent: 'text-accent dark:text-accent-dark',
  onAccent: 'text-onAccent dark:text-onAccent-dark',
} as const;

export const line = {
  border: 'border-border dark:border-border-dark',
  rule: 'bg-border dark:bg-border-dark',
} as const;

export const t = {
  screen: `flex-1 ${bg.page}`,
  page: 'px-5',

  /** Small caps over a section: "THIS MONTH". */
  label: `text-[11px] font-semibold uppercase tracking-[1.6px] ${ink.tertiary}`,
  /** A screen's own name. */
  title: `text-[28px] font-semibold ${ink.primary}`,
  /** A section's name, above its content. */
  section: `text-[20px] font-semibold ${ink.primary}`,
  heading: `text-base font-semibold ${ink.primary}`,
  body: `text-[15px] ${ink.primary}`,
  muted: `text-[13px] ${ink.secondary}`,
  faint: `text-[12px] ${ink.tertiary}`,

  amount: `text-[15px] font-medium ${ink.primary}`,
  amountIn: `text-[15px] font-medium ${ink.positive}`,
  amountOut: `text-[15px] font-medium ${ink.primary}`,
  /** A card's main number. */
  figure: `text-[24px] font-semibold ${ink.primary}`,
  /** The one number a screen is about. */
  hero: `text-[40px] font-bold ${ink.primary}`,

  rule: `h-px ${line.rule}`,
  row: 'flex-row items-center justify-between py-4',

  /** A soft surface with a hairline edge; sits on the page background. */
  card: `rounded-3xl border ${line.border} ${bg.surface} p-5`,
  /** Same surface without the edge, for a card that already has content to frame it. */
  cardFlat: `rounded-3xl ${bg.surface} p-5`,
  chip: `self-start rounded-full ${bg.muted} px-2.5 py-1`,

  primaryButton: `rounded-2xl ${bg.accent} py-4`,
  primaryLabel: `text-center text-[15px] font-semibold ${ink.onAccent}`,
  ghostButton: `rounded-2xl border ${line.border} ${bg.surface} py-4`,
  ghostLabel: `text-center text-[15px] font-medium ${ink.primary}`,

  input: `rounded-2xl border ${line.border} ${bg.surface} px-4 py-3.5 text-[15px] ${ink.primary}`,
} as const;
