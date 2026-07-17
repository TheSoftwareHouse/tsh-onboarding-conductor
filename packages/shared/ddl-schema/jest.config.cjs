const path = require('node:path');
const baseConfig = require('../../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['<rootDir>/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.json'),
      },
    ],
  },
};
