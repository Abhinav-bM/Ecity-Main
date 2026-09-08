import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts', '*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Money rules apply to application code only. Tests legitimately round
    // pixel measurements, which is not money.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Money is bigint paise everywhere (docs/03 §4.1).
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Money is bigint paise - never parseFloat an amount. See docs/03 §4.1.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='round']",
          message:
            'Rounding suggests float money. Use integer paise arithmetic. See docs/03 §4.1.',
        },
      ],
    },
  },
  {
    /*
     * Build scripts and config files are plain JavaScript running in Node.
     *
     * The block above only reaches .ts/.tsx, so `process` and `console` in a
     * .mjs script were undefined globals — which CI catches and a local
     * `eslint src tests` does not.
     */
    files: ['**/*.mjs', '**/*.js', 'scripts/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // Tests and scripts may be looser.
    files: ['tests/**/*.ts', 'src/server/db/seed.ts', 'src/server/db/migrate.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      // `({}, testInfo) => ...` is Playwright's documented conditional-skip
      // signature; the empty pattern is intentional.
      'no-empty-pattern': 'off',
    },
  },
)
