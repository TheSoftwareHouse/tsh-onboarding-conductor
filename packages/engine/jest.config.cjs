const path = require('node:path');
const baseConfig = require('../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@tsh/ddl-schema$': '<rootDir>/../shared/ddl-schema/src/index.ts',
    '^@tsh/ddl-schema/(.*)$': '<rootDir>/../shared/ddl-schema/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.json'),
      },
    ],
  },
};
