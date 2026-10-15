// Describes the run, not the code under test: where the engine stack is and which workflow a
// session starts. Anything already in the process environment wins, so a shifted-port stack is
// targeted with `ENGINE_BASE_URL` and `UPLOAD_PUBLIC_HOST` alone.
const path = require('node:path');

process.env.NODE_ENV = 'test';

const defaults = {
  ENGINE_BASE_URL: 'http://localhost:3000',
  UPLOAD_PUBLIC_HOST: 'http://localhost:3900',
  BNPL_WORKFLOW_ID: 'credit-check',
  PERSONAS_DIR: path.resolve(__dirname, '../personas'),
  DEMO_WEB_ORIGIN: 'http://localhost:5173',
  ENGINE_REQUEST_TIMEOUT_MS: '10000',
  // Validated but unused: the suite listens on an ephemeral port itself.
  DEMO_BFF_PORT: '3100',
};

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] ??= value;
}
