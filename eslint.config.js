// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const FORBIDDEN_CORE_GLOBALS = ['Meta', 'Shell', 'St', 'Clutter', 'global', 'Main'];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'packages/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // §2.2 / §34: core and platform must never touch the compositor.
    files: ['src/core/**/*.ts', 'src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['gi://*', 'resource://*'],
              message: 'core/ and platform/ must not import compositor APIs (§2.2).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...FORBIDDEN_CORE_GLOBALS.map((name) => ({
          selector: `Identifier[name='${name}']`,
          message: `core/ and platform/ must not reference ${name} (§2.2, §34).`,
        })),
      ],
    },
  },
);
