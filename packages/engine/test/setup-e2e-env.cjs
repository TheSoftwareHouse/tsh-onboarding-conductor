// The e2e suites configure the engine the way a deployment does: everything describing the
// environment — database, Redis, object storage, provider credentials — comes from .env, which
// `cp .env.dist .env` produces and CI creates the same way. Specs therefore set only what is
// genuinely per-test, such as a temporary workflow directory or the URL of a server the test
// itself started.
//
// What is left here describes the run rather than the environment: NODE_ENV marks these
// processes as tests, which is also what makes the CONNECTOR_MOCKS pairs in .env apply.
process.env.NODE_ENV = 'test';

// The compose stack owns migrations and the outbox worker; suites that need another role, the
// webhook outbox queue one, override MODE per test.
process.env.MODE = 'api-only';

// Test-only values for the settings ADMIN_AUTH_ENABLED=true requires, so every auth-on spec boots
// without a developer's .env carrying real ones.
process.env.BETTER_AUTH_SECRET = 'e2e-better-auth-secret-0123456789abcdef';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.AUTH_SMTP_URL = 'smtp://localhost:1025';
process.env.AUTH_MAIL_FROM = 'no-reply@example.test';
