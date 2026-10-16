const path = require('node:path');
const fs = require('node:fs');

const baseConfigPath = path.resolve(__dirname, '../../../jest.base.config.cjs');
const baseConfig = fs.existsSync(baseConfigPath)
  ? require(baseConfigPath)
  : {
      testEnvironment: 'node',
      moduleFileExtensions: ['ts', 'js', 'json'],
      clearMocks: true,
      restoreMocks: true,
    };

module.exports = {
  ...baseConfig,
  rootDir: path.resolve(__dirname, '..'),
  // Applies the run-level configuration before any spec, so no suite has to restate the
  // environment; the rest of it is read from .env by the engine's own ConfigModule.
  setupFiles: [path.resolve(__dirname, 'setup-e2e-env.cjs')],
  setupFilesAfterEnv: [path.resolve(__dirname, 'setup-e2e-sockets.cjs')],
  // Every suite here boots the real application against the Docker stack, and some boot it more
  // than once inside a single hook. Jest's 5 s default is a unit-test budget; on the CI runner one
  // boot alone takes close to 3 s. Owned here so no suite has to restate it.
  testTimeout: 30000,
  testMatch: [
    process.env.JEST_E2E_SPEC
      ? `<rootDir>/test/${process.env.JEST_E2E_SPEC}`
      : '<rootDir>/test/**/*.e2e-spec.ts',
  ],
  // Both need MailHog's SMTP port, which only the Compose network reaches, so they run in the
  // `pnpm test:mailhog:integration` flow rather than in the default run.
  testPathIgnorePatterns: process.env.JEST_E2E_SPEC
    ? []
    : ['<rootDir>/test/smtp.e2e-spec.ts', '<rootDir>/test/otp-email.e2e-spec.ts'],
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
