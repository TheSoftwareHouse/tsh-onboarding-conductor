const path = require('node:path');
const baseConfig = require('../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // @faker-js/faker ships ES modules only; let ts-jest transpile it instead of leaving node_modules alone.
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/@faker-js\\+faker@|@faker-js/faker/)'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.spec.json'),
      },
    ],
  },
};
