import { ConfigService } from '@nestjs/config';
import { SmtpMailhogConnector } from '../src/connectors/adapters/smtp-mailhog.connector';
import type { ConnectorExecutionInput } from '../src/connectors/ports/connector-adapter.port';

const MAILHOG_API_URL = 'http://mailhog:8025/api/v1/messages';
const SMTP_FROM = 'sender@example.com';

type MailHogMessage = {
  Content: {
    Headers: Record<string, string | string[]>;
    Body: string;
  };
};

type MailHogResponse = {
  items: MailHogMessage[];
};

const createInput = (payload: Record<string, unknown>, html: string): ConnectorExecutionInput => ({
  declaration: {
    order: 1,
    config: {
      body: {
        html,
      },
    },
  },
  execution: {
    onboardingId: 'mailhog-test-onboarding',
    stepName: 'send-email',
  },
  context: {},
  payload,
  payloadFieldSources: {},
});

const createConnector = (overrides: Record<string, unknown> = {}): SmtpMailhogConnector =>
  new SmtpMailhogConnector(
    new ConfigService({
      SMTP_ENABLED: true,
      SMTP_HOST: 'mailhog',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_STARTTLS: false,
      SMTP_FROM,
      SMTP_TIMEOUT_MS: 5000,
      ...overrides,
    }),
  );

const clearMessages = async (): Promise<void> => {
  const response = await fetch(MAILHOG_API_URL, { method: 'DELETE' });
  expect(response.ok).toBe(true);
};

const getMessages = async (): Promise<MailHogMessage[]> => {
  const response = await fetch(MAILHOG_API_URL);
  expect(response.ok).toBe(true);
  const body = (await response.json()) as MailHogMessage[] | MailHogResponse;
  return Array.isArray(body) ? body : body.items;
};

const getHeader = (message: MailHogMessage, name: string): string => {
  const value = message.Content.Headers[name];
  return Array.isArray(value) ? value[0] : value;
};

describe('SmtpMailhogConnector (e2e)', () => {
  beforeEach(async () => {
    await clearMessages();
  });

  afterEach(async () => {
    await clearMessages();
  });

  afterAll(async () => {
    await clearMessages();
  });

  it('should deliver a prepared message and expose its capture through MailHog', async () => {
    const recipient = 'recipient@example.com';
    const subject = 'MailHog integration subject';
    const message = 'MailHog integration body';

    const result = await createConnector().execute(
      createInput({ recipient, subject, message }, '<p>{{message}}</p>'),
    );

    expect(result.status).toBe('accepted');

    const messages = await getMessages();
    expect(messages).toHaveLength(1);
    expect(getHeader(messages[0], 'To')).toContain(recipient);
    expect(getHeader(messages[0], 'From')).toContain(SMTP_FROM);
    expect(getHeader(messages[0], 'Subject')).toBe(subject);
    expect(messages[0].Content.Body).toContain(message);
  });

  it('should reject an unreachable SMTP endpoint within the configured timeout', async () => {
    const startedAt = Date.now();

    const result = await createConnector({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: 65534,
      SMTP_TIMEOUT_MS: 250,
    }).execute(
      createInput(
        {
          recipient: 'recipient@example.com',
          subject: 'Unreachable SMTP subject',
          message: 'Unreachable SMTP body',
        },
        '<p>{{message}}</p>',
      ),
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('CONNECTOR_REJECTED');
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(await getMessages()).toHaveLength(0);
  });
});
