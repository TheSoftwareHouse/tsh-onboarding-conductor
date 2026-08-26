import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import { EmailTemplateLoaderService } from '../../../email-templates/email-template-loader.service';
import type { ConnectorSettingsService } from '../../connector-settings.service';
import { ConnectorNotConfiguredException } from '../../errors/connector-not-configured.exception';
import { SmtpConnector } from './smtp.connector';

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

const createSettingsService = (values: Record<string, string> = {}) =>
  ({
    resolve: jest.fn().mockResolvedValue({
      find: (key: string) => values[key],
      get: (key: string) => {
        if (values[key] === undefined) {
          throw new ConnectorNotConfiguredException('smtp', key);
        }

        return values[key];
      },
      entries: () => values,
    }),
  }) as unknown as ConnectorSettingsService;

const createConnector = (
  configService: ConfigService,
  settingsService: ConnectorSettingsService = createSettingsService(),
): SmtpConnector =>
  new SmtpConnector(configService, new EmailTemplateLoaderService(configService), settingsService);

const createMockTransport = () => {
  const transport = {
    sendMail: jest.fn(),
  } as MockSendMailTransport;

  mockedCreateTransport.mockReturnValue(transport as never);

  return transport;
};

describe('smtp', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('maps payload values to the SMTP envelope and validates header-safe fields before sending', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockResolvedValue({ accepted: ['person@example.com'], rejected: [] });

    const connector = createConnector(
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
    const connector = createConnector(
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
    const connector = createConnector(
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
    const connector = createConnector(
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
    const connector = createConnector(
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

    const settingsService = createSettingsService({ username: 'smtp-user', password: 'smtp-pass' });
    const connector = createConnector(
      createConfigService({
        SMTP_ENABLED: true,
        SMTP_HOST: 'mailhog',
        SMTP_PORT: 1025,
        SMTP_SECURE: true,
        SMTP_STARTTLS: false,
        SMTP_FROM: 'sender@example.com',
        SMTP_TIMEOUT_MS: 4000,
      }),
      settingsService,
    );

    await connector.execute(createConnectorInput());

    expect(settingsService.resolve).toHaveBeenCalledWith(connector);
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
    const startTlsConnector = createConnector(
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

  it('rejects execution when SMTP is disabled', async () => {
    const transport = createMockTransport();
    const connector = createConnector(
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

    await expect(connector.execute(createConnectorInput())).resolves.toEqual(
      ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'),
    );
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('returns rejected when recipients are rejected and accepted otherwise', async () => {
    const rejectedTransport = createMockTransport();
    rejectedTransport.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ['person@example.com'],
    });

    const connector = createConnector(
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
    const connector = createConnector(
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
    const connector = createConnector(
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

  it('returns rejected for transport failures without sensitive metadata or logs', async () => {
    const transport = createMockTransport();
    transport.sendMail.mockRejectedValue(new Error('smtp: connection failed'));

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const connector = createConnector(
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

    const result = await connector.execute(createConnectorInput());

    expect(result).toEqual(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));
    expect(result.metadata).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
