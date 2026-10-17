import react from '@vehicle-os/eslint-config/react';

export default [
  ...react,
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
