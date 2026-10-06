export type ColorToken =
  | 'background'
  | 'surface'
  | 'surfaceElevated'
  | 'surfaceMuted'
  | 'textPrimary'
  | 'textSecondary'
  | 'textTertiary'
  | 'border'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'accent'
  | 'onAccent';

export type Colors = Record<ColorToken, string>;

export const palette: { light: Colors; dark: Colors };
