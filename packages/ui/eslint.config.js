import base from '@vehicle-os/eslint-config';

export default [
  ...base,
  {
    rules: {
      // This package runs on the phone too, and React Native 0.76's Hermes has no `toSorted`.
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
