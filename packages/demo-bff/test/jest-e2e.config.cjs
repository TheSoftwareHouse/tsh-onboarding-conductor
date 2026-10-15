const path = require('node:path');
const baseConfig = require('../../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: path.resolve(__dirname, '..'),
  setupFiles: [path.resolve(__dirname, 'setup-e2e-env.cjs')],
  // Each scenario drives a real engine and long-polls it, well past Jest's 5 s unit-test budget.
  testTimeout: 60000,
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.e2e.json'),
      },
    ],
  },
};
