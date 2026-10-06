const { palette } = require('./src/ui/palette');

// One Tailwind colour per semantic token, in a light and a dark spelling:
// `bg-surface dark:bg-surface-dark`. The values live in src/ui/palette.js, so
// classes and native style props can never drift apart.
const semantic = {};
for (const [token, value] of Object.entries(palette.light)) {
  semantic[token] = value;
  semantic[`${token}-dark`] = palette.dark[token];
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.ts', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class' (not the default 'media'): dark mode is a setting the user picks in
  // the app, not just the phone's system theme, though "System" is offered
  // as one of the three choices.
  darkMode: 'class',
  theme: { extend: { colors: semantic } },
  plugins: [],
};
