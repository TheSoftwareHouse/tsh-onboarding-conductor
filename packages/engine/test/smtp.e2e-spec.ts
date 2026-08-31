import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SmtpConnector } from '../src/connectors/adapters/built-in/smtp.connector';
import { ConnectorsRepository } from '../src/connectors/connectors.repository';
import { ConnectorSettingsService } from '../src/connectors/connector-settings.service';
import { ConnectorEntity } from '../src/connectors/entity/connector.entity';
import { EmailTemplateLoaderService } from '../src/email-templates/email-template-loader.service';
import type { ConnectorExecutionInput } from '../src/connectors/ports/connector-adapter.port';

const MAILHOG_API_URL = 'http://mailhog:8025/api/v1/messages';
const SMTP_FROM = 'sender@example.com';
const SMTP_CONNECTOR_TYPE = 'smtp';

/**
 * This container joins only the `postgres` and `mailhog` services (see
 * `engine-mailhog-test` in `docker-compose.yml`) — no Redis, no object storage — so the
 * connection is built directly rather than by dynamically importing `AppModule`, which
 * would demand the whole stack's configuration just to resolve one connector's settings.
 */
const DATABASE_URL =
  'postgres://orchestrator:orchestrator_pass@postgres:5432/orchestrator?sslmode=disable';

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

describe('SmtpConnector (e2e)', () => {
  let dataSource: DataSource;
  let connectorSettingsService: ConnectorSettingsService;

  /**
   * Builds the connector exactly as `ConnectorsModule` wires it, resolving `username` /
   * `password` through the real `ConnectorSettingsService` against the real
   * `connectors` table — MailHog needs no credentials, so an absent row is a
   * genuine "unset" configuration, not a hand-written stand-in for one.
   */
  const createConnector = (overrides: Record<string, unknown> = {}): SmtpConnector => {
    const configService = new ConfigService({
      SMTP_ENABLED: true,
      SMTP_HOST: 'mailhog',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
      SMTP_STARTTLS: false,
      SMTP_FROM,
      SMTP_TIMEOUT_MS: 5000,
      ...overrides,
    });

    return new SmtpConnector(
      configService,
      new EmailTemplateLoaderService(configService),
      connectorSettingsService,
    );
  };

  const deleteStoredRow = async (): Promise<void> => {
    await dataSource.query('DELETE FROM connectors WHERE id = $1', [SMTP_CONNECTOR_TYPE]);
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [ConnectorEntity],
      migrations: [join(__dirname, '../src/database/migrations/*.[tj]s')],
      migrationsRun: true,
      synchronize: false,
    });
    await dataSource.initialize();
    connectorSettingsService = new ConnectorSettingsService(new ConnectorsRepository(), dataSource);

    // Leaves no row behind from a previous run that failed before its own cleanup ran.
    await deleteStoredRow();
  }, 60000);

  afterAll(async () => {
    await deleteStoredRow();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await clearMessages();
    await deleteStoredRow();
  });

  afterEach(async () => {
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
