import react from '@vehicle-os/eslint-config/react';

// The Vite config runs in Node and sits outside the app's tsconfig, which type-aware rules need.
export default [{ ignores: ['vite.config.ts', 'dist'] }, ...react];
