import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Base config for every workspace. The rules below are the ones that caught real
 * bugs during the build; stylistic preferences are left to Prettier.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.next/**',
      '.turbo/**',
      'node_modules/**',
      '**/*.gen.ts',
      // Written by `next build` and overwritten on every run; its triple-slash reference
      // is required by Next and cannot be changed.
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
      parserOptions: {
        // Type-aware linting. `no-floating-promises` — the rule most likely to catch a real
        // bug here — cannot work without it; it needs to know which calls return a promise.
        // `projectService` finds the nearest tsconfig per file, so each workspace package
        // resolves its own without this shared config knowing any paths.
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      /*
       * Floating promises are the single most common way an async handler silently
       * swallows a rejection: the request returns 200 while the write never landed.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // Config files are plain JS with no tsconfig covering them; type-aware rules would throw
  // rather than lint. Everything untyped is checked by the non-type-aware rules only.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  /*
   * CommonJS build configuration — Metro's config in particular, which must stay CJS
   * because Metro loads it with `require`. Without declaring the module system here,
   * `require`, `module` and `__dirname` all read as undefined globals.
   */
  {
    files: ['**/*.cjs', '**/*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  /*
   * ESM build configuration — `next.config.mjs` and its kin. The `.config.js` group above
   * cannot cover these: it declares CommonJS, which is exactly what a `.mjs` file is not.
   * They still run under Node, so `process` is a legitimate global there.
   */
  {
    files: ['**/*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  /*
   * Build scripts. They live inside an app whose config supplies browser globals, but they
   * run under Node — `console` and `process` are legitimate there, and a build script that
   * cannot report what it did is not much of a build script.
   */
  {
    files: ['**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  prettier,
);
