import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import { SmtpEmailUnavailableException } from '../../errors/smtp-email-unavailable.exception';
import { SmtpEmailConnector } from './smtp-email.connector';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const mockedCreateTransport = jest.mocked(createTransport);

type MockSendMailTransport = {
  sendMail: jest.Mock;
};

const createConnectorInput = (
  payloadOverrides: Record<string, unknown> = {},
  configOverrides: Record<string, unknown> = {},
) => ({
  declaration: {
    order: 1,
    config: {
      body: {
        html: '<p>{{message}}</p>',
      },
      ...configOverrides,
    },
  },
  execution: {
    onboardingId: 'onboarding-1',
    stepName: 'smtp-test',
  },
  context: {},
  payload: {
    recipient: 'person@example.com',
    subject: 'Hello there',
    message: 'This is a test body',
    ...payloadOverrides,
  },
  payloadFieldSources: {
    recipient: 'email',
    subject: 'subject',
    message: 'message',
  },
});

const createConfigService = (overrides: Record<string, unknown> = {}) => {
  return {
    get: jest.fn((key: string) => overrides[key]),
  } as unknown as ConfigService;
};

const createMockTransport = () => {
  const transport = {
    sendMail: jest.fn(),
  } as MockSendMailTransport;

  mockedCreateTransport.mockReturnValue(transport as never);

  return transport;
};

describe('SmtpEmailConnector', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('maps payload values to the SMTP envelope and validates header-safe fields before sending', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });

    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(connector.execute(createConnectorInput())).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );

    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailhog',
        port: 1025,
        ignoreTLS: true,
        timeout: 3000,
        connectionTimeout: 3000,
      }),
    );

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender@example.com',
        to: 'person@example.com',
        subject: 'Hello there',
        html: '<p>This is a test body</p>',
      }),
    );
  });

  it('renders repeated template variables and escapes HTML values before sending', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await connector.execute(
      createConnectorInput(
        { firstName: `<Ada & 'Grace'>` },
        { body: { html: '<p>{{firstName}}</p><strong>{{firstName}}</strong>' } },
      ),
    );

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<p>&lt;Ada &amp; &#39;Grace&#39;&gt;</p><strong>&lt;Ada &amp; &#39;Grace&#39;&gt;</strong>',
      }),
    );
  });

  it('inserts dollar replacement tokens as literal escaped variable values', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await connector.execute(
      createConnectorInput(
        { firstName: "$& $` $' $$" },
        { body: { html: '<p>{{firstName}}</p>' } },
      ),
    );

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<p>$&amp; $` $&#39; $$</p>',
      }),
    );
  });

  it.each([
    ['missing template config', { body: undefined }, { message: 'value' }],
    ['missing variable', { body: { html: '<p>{{missing}}</p>' } }, { message: 'value' }],
    ['non-string variable', { body: { html: '<p>{{message}}</p>' } }, { message: 42 }],
    ['malformed placeholder', { body: { html: '<p>{{message</p>' } }, { message: 'value' }],
    ['unsupported expression', { body: { html: '<p>{{message.name}}</p>' } }, { message: 'value' }],
  ])('rejects %s before transport use', async (_caseName, config, payload) => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(connector.execute(createConnectorInput(payload, config))).resolves.toMatchObject({
      status: 'invalid-data',
      errors: { body: ['INVALID'] },
    });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('rejects invalid payload values before transport use', async () => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(
      connector.execute(
        createConnectorInput(
          {
            recipient: 'bad\r\nrecipient@example.com',
            subject: 'bad\nsubject',
            message: '',
          },
          {
            body: { html: '<p>{{message}}</p>' },
          },
        ),
      ),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        {
          recipient: ['INVALID'],
          subject: ['INVALID'],
          body: ['INVALID'],
        },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );

    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('maps TLS options and auth values to nodemailer transport options', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });

    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: true,
        SMTP_STARTTLS: false,
        SMTP_USERNAME: 'smtp-user',
        SMTP_PASSWORD: 'smtp-pass',
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 4000,
      }),
    );

    await connector.execute(createConnectorInput());

    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        auth: { user: 'smtp-user', pass: 'smtp-pass' },
        timeout: 4000,
        connectionTimeout: 4000,
      }),
    );

    jest.resetAllMocks();
    createMockTransport();
    const startTlsConnector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: true,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 5000,
      }),
    );

    const startTlsTransport = createMockTransport();
    startTlsTransport.sendMail.mockResolvedValue({
      accepted: ['person@example.com'],
      rejected: [],
    });

    await startTlsConnector.execute(createConnectorInput());

    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
      }),
    );
  });

  it('reports an outage instead of rejecting when SMTP is disabled', async () => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: false,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(connector.execute(createConnectorInput())).rejects.toBeInstanceOf(
      SmtpEmailUnavailableException,
    );
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank sender', { SMTP_FROM: '   ' }],
    ['a malformed sender', { SMTP_FROM: 'not-an-email' }],
    ['a missing host', { SMTP_HOST: '' }],
    ['a missing port', { SMTP_PORT: undefined }],
    ['a non-positive timeout', { SMTP_TIMEOUT_MS: 0 }],
    ['a missing timeout', { SMTP_TIMEOUT_MS: undefined }],
  ])('reports an outage instead of blaming a field for %s', async (_label, overrides) => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
        ...overrides,
      }),
    );

    await expect(connector.execute(createConnectorInput())).rejects.toBeInstanceOf(
      SmtpEmailUnavailableException,
    );
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('returns rejected when recipients are rejected and accepted otherwise', async () => {
    const rejectedTransport = createMockTransport();
    rejectedTransport.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ['person@example.com'],
    });

    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(connector.execute(createConnectorInput())).resolves.toEqual(
      ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
    );

    const acceptedTransport = createMockTransport();
    acceptedTransport.sendMail.mockResolvedValue({
      accepted: ['person@example.com'],
      rejected: [],
    });

    await expect(connector.execute(createConnectorInput())).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );
  });

  it('rejects syntactically malformed recipients before transport use', async () => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    await expect(
      connector.execute(
        createConnectorInput({
          recipient: 'not-an-email',
        }),
      ),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        {
          recipient: ['INVALID'],
        },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );

    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('rejects subject and body values that exceed the bounded maximums', async () => {
    const transport = createMockTransport();
    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    const longSubject = 'x'.repeat(1000);
    const longBody = 'y'.repeat(100001);

    await expect(
      connector.execute(
        createConnectorInput(
          {
            subject: longSubject,
            message: 'message',
          },
          {
            body: { html: longBody },
          },
        ),
      ),
    ).resolves.toEqual(
      ConnectorExecutionResult.invalidData(
        {
          subject: ['INVALID'],
          body: ['INVALID'],
        },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );

    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('reports transport failures as an outage without leaking the underlying cause', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockRejectedValue(
      new Error('smtp: connection failed for user@internal.example.com'),
    );

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const connector = new SmtpEmailConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 3000,
      }),
    );

    // A network blip must not permanently reject the onboarding.
    const error = await connector
      .execute(createConnectorInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SmtpEmailUnavailableException);
    expect(JSON.stringify((error as SmtpEmailUnavailableException).getResponse())).not.toContain(
      'internal.example.com',
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  describe('templatePath resolution', () => {
    let fixtureDir: string;

    beforeEach(() => {
      fixtureDir = mkdtempSync(join(tmpdir(), 'smtp-template-'));
      mkdirSync(join(fixtureDir, 'templates'));
      writeFileSync(join(fixtureDir, 'templates', 'mail.html'), '<p>{{message}}</p>', 'utf8');
    });

    afterEach(() => {
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    const connectorWithSources = (sources: Record<string, unknown>) =>
      new SmtpEmailConnector(
        createConfigService({
          SMTP_ENABLED: true,
          SMTP_HOST: 'mailhog',
          SMTP_PORT: 1025,
          SMTP_SECURE: false,
          SMTP_STARTTLS: false,
          SMTP_FROM: 'sender@example.com',
          SMTP_TIMEOUT_MS: 3000,
          ...sources,
        }),
      );

    it.each([
      ['the built-in source', 'BUILTIN_WORKFLOWS_DIR'],
      ['the user source', 'WORKFLOWS_DIR'],
      ['the fixture source', 'FIXTURE_WORKFLOWS_DIR'],
    ])('resolves a template held by %s', async (_label, configKey) => {
      const transport = createMockTransport();
      transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });

      const connector = connectorWithSources({ [configKey]: fixtureDir });

      await expect(
        connector.execute(createConnectorInput({}, { templatePath: 'templates/mail.html' })),
      ).resolves.toEqual(ConnectorExecutionResult.accepted());

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<p>This is a test body</p>' }),
      );
    });

    it('refuses a templatePath that escapes its source directory', async () => {
      const transport = createMockTransport();
      const outsideDir = mkdtempSync(join(tmpdir(), 'smtp-outside-'));
      writeFileSync(join(outsideDir, 'secret.html'), '<p>{{message}}</p>', 'utf8');

      const connector = connectorWithSources({ FIXTURE_WORKFLOWS_DIR: fixtureDir });

      const result = await connector.execute(
        createConnectorInput({}, { templatePath: `../${basename(outsideDir)}/secret.html` }),
      );

      expect(result.status).toBe('invalid-data');
      expect(result.errors).toEqual({ body: ['INVALID'] });
      expect(transport.sendMail).not.toHaveBeenCalled();

      rmSync(outsideDir, { recursive: true, force: true });
    });

    it('reports an invalid body when no configured source holds the template', async () => {
      const transport = createMockTransport();
      const connector = connectorWithSources({ FIXTURE_WORKFLOWS_DIR: fixtureDir });

      const result = await connector.execute(
        createConnectorInput({}, { templatePath: 'templates/missing.html' }),
      );

      expect(result.status).toBe('invalid-data');
      expect(transport.sendMail).not.toHaveBeenCalled();
    });
  });
});
