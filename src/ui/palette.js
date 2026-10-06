/**
 * The colours of Hisaab, once. Plain JS so tailwind.config.js can read it
 * (Node cannot load TypeScript there) and the app can import the same values
 * for the few places a className cannot reach: native style props, icons.
 *
 * Semantic names, not shades: a screen asks for "surface" or "textSecondary"
 * and the theme decides what that is in light and dark.
 */
const palette = {
  light: {
    background: '#F6F6F3',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#EEEEEA',
    textPrimary: '#121212',
    textSecondary: '#5C5C57',
    textTertiary: '#8B8B85',
    border: '#E4E4DE',
    positive: '#15803D',
    negative: '#D92D20',
    warning: '#B45309',
    accent: '#0F7A55',
    /** Text or icons drawn on top of `accent`. */
    onAccent: '#FFFFFF',
  },
  dark: {
    background: '#0A0A0A',
    surface: '#151516',
    surfaceElevated: '#1D1D1F',
    surfaceMuted: '#232326',
    textPrimary: '#F5F5F3',
    textSecondary: '#A6A6A0',
    textTertiary: '#71716C',
    border: '#2B2B2E',
    positive: '#4ADE80',
    negative: '#F87171',
    warning: '#FBBF24',
    accent: '#34D399',
    onAccent: '#06281C',
  },
};

module.exports = { palette };
