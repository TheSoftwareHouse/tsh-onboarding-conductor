const path = require('node:path');
const baseConfig = require('../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // jose ships ES modules only; let ts-jest transpile it instead of leaving node_modules alone.
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/jose@|jose/)'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.spec.json'),
      },
    ],
  },
};
