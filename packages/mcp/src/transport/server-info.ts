import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  version: string;
};

export const SERVER_INFO = { name: 'tsh-onboarding-conductor-mcp', version };
