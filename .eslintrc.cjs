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
      // Served verbatim to the browser as a classic script, so it assigns to `window` at global
      // scope rather than exporting anything. This config's env is node + jest, which the rest of
      // the repository needs, so the browser globals are granted here instead. lint-staged runs
      // eslint from the repository root, so without this the pre-commit hook rejects the file.
      files: ['packages/admin-panel/public/*.js'],
      env: {
        browser: true,
      },
    },
    {
      // An adapter that injects `ConnectorSettingsAdminService` — easy to reach for by
      // mistake given the near-identical name — reinstates the dependency cycle that
      // hangs Nest at bootstrap: the admin service depends on
      // `CONNECTOR_ADAPTER_COLLECTION`, which injects every adapter. Adapters resolve
      // their own settings through `ConnectorSettingsService` instead.
      files: ['packages/engine/src/connectors/adapters/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['connector-settings-admin.service*'],
                message:
                  'Adapters must not import ConnectorSettingsAdminService — it depends on ' +
                  'CONNECTOR_ADAPTER_COLLECTION, and an adapter depending on it closes a DI ' +
                  'cycle that hangs Nest at bootstrap. Inject ConnectorSettingsService instead.',
              },
            ],
          },
        ],
      },
    },
  ],
};
