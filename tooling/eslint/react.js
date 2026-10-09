import globals from 'globals';
import base from './index.js';

/** Browser/React variant: adds DOM globals to the base config. */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
