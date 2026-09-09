import js from '@eslint/js';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: {
      // Tailwind v4 has no config file, so the plugin reads the theme from the CSS entry point.
      // No `callees` here on purpose: the plugin already ships selectors for both `cn` and `tv`,
      // and naming them as bare strings replaces those, leaving a matcher that only sees a plain
      // string argument — so every class inside `tv({ base, variants })` went unlinted.
      'better-tailwindcss': {
        entryPoint: 'src/app/tailwind.css',
      },
    },
    rules: {
      'better-tailwindcss/enforce-canonical-classes': 'error',
      'better-tailwindcss/enforce-consistent-class-order': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      // TODO: enable once the legacy BEM classes are gone — it cannot tell one from a typo and
      // reports all ~130 today. It is what catches an off-system class such as `bg-slate-500`.
      'better-tailwindcss/no-unknown-classes': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
