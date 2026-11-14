import react from '@vehicle-os/eslint-config/react';
import hooks from 'eslint-plugin-react-hooks';

export default [
  ...react,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      // A hook called conditionally breaks on the render that skips it; an effect missing a
      // dependency acts on stale values. Neither shows in a typecheck.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      // React Native 0.76's Hermes has no `Array.prototype.toSorted`: a call typechecks, passes in
      // a browser, and throws on the phone. Found the hard way on the add form (2026-10-12).
      'no-restricted-properties': [
        'error',
        {
          property: 'toSorted',
          message: 'Hermes has no toSorted; sort a copy: [...items].sort().',
        },
      ],
    },
  },
];
