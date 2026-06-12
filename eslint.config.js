// Flat config (ESLint v9). Scoped to the React client source: the rest of the
// repo (shared/, api/, supabase/, scripts/) is TypeScript and is covered by
// `npm run typecheck`. The primary value here is `no-undef` — it catches a
// reference to something that was moved/deleted, which is exactly the failure
// mode when extracting helpers out of the App.jsx monolith. The react plugin's
// jsx-uses-vars teaches no-undef/no-unused-vars that `<Foo/>` references `Foo`.

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      '**/*.ts',
      '**/*.tsx',
    ],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        process: 'readonly',
        chrome: 'readonly',
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      // Core safety net for the extraction work.
      'no-undef': 'error',
      // JSX-aware: mark component identifiers used in JSX as "used".
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off', // new JSX transform — no React import needed
      // Helpful but non-blocking on a large legacy file.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^(_|React)', caughtErrorsIgnorePattern: '^(_|e(rr)?)$', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-cond-assign': ['error', 'except-parens'],
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
