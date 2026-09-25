const path = require('node:path');
const baseConfig = require('../../jest.base.config.cjs');

module.exports = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // The DDL is resolved to its TypeScript source, the way the engine's config does, so the specs
  // need no build of that package and cannot race a typecheck that rebuilds its `dist`.
  moduleNameMapper: {
    '^@tsh/ddl-schema$': '<rootDir>/../shared/ddl-schema/src/index.ts',
    '^@tsh/ddl-schema/(.*)$': '<rootDir>/../shared/ddl-schema/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: path.resolve(__dirname, 'tsconfig.spec.json'),
      },
    ],
  },
};
