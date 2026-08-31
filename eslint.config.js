import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'test-results', 'playwright-report', 'coverage', 'node_modules'] },
  js.configs.recommended,
  {
    // Type-aware linting is scoped to TypeScript: the config files themselves
    // are plain JS/ESM and have no program to type-check against.
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // CLAUDE.md: every exported function has an explicit return type.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // CLAUDE.md: no `any` without a comment explaining why it is unavoidable.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['*.config.ts', 'tests/**/*.ts', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
