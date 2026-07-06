const path = require('node:path');
const baseConfig = require('../../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: path.resolve(__dirname, '..'),
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, '../tsconfig.json'),
      },
    ],
  },
  moduleNameMapper: {
    '^@tsh/shared$': '<rootDir>/../shared/src/index.ts',
    '^@tsh/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@tsh/ddl-schema$': '<rootDir>/../shared/ddl-schema/src/index.ts',
    '^@tsh/ddl-schema/(.*)$': '<rootDir>/../shared/ddl-schema/src/$1',
    '^@tsh/openapi$': '<rootDir>/../shared/openapi/src/index.ts',
    '^@tsh/openapi/(.*)$': '<rootDir>/../shared/openapi/src/$1',
  },
};
