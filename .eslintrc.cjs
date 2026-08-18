module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  overrides: [
    {
      files: ['**/*.cjs'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // Sandbox connectors fake their providers. Only the module that registers them behind
      // SANDBOX_CONNECTORS_ENABLED, and tests, may reach into that directory — otherwise a mock
      // can find its way into a production code path by import alone.
      files: ['packages/engine/src/**/*.ts'],
      excludedFiles: [
        'packages/engine/src/connectors/connectors.module.ts',
        'packages/engine/src/connectors/adapters/sandbox/**/*.ts',
        'packages/engine/src/**/*.spec.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/adapters/sandbox/*', '**/adapters/sandbox/**'],
                message:
                  'Sandbox connectors are test-only. Register them in ConnectorsModule behind SANDBOX_CONNECTORS_ENABLED instead of importing them directly.',
              },
            ],
          },
        ],
      },
    },
  ],
};
