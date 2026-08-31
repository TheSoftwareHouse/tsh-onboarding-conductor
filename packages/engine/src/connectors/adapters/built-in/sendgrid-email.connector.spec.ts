import sgMail from '@sendgrid/mail';
import type { ConnectorSettingsService } from '../../connector-settings.service';
import { ConnectorNotConfiguredException } from '../../errors/connector-not-configured.exception';
import { SendgridEmailUnavailableException } from '../../errors/sendgrid-email-unavailable.exception';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../ports/connector-execution-result';
import { SendgridEmailConnector } from './sendgrid-email.connector';

jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

const mockedSgMail = sgMail as jest.Mocked<typeof sgMail>;

const createSettingsService = (
  values: Record<string, string> = { apiKey: 'sg-test-key', from: 'sender@example.com' },
) =>
  ({
    resolve: jest.fn().mockResolvedValue({
      find: (key: string) => values[key],
      get: (key: string) => {
        if (values[key] === undefined) {
          throw new ConnectorNotConfiguredException('sendgrid_email', key);
        }

        return values[key];
      },
      entries: () => values,
    }),
  }) as unknown as ConnectorSettingsService;

const createInput = (payload: Record<string, unknown> = {}) => ({
  declaration: {
    order: 1,
    config: {},
  },
  execution: {
    onboardingId: 'onboarding-1',
    stepName: 'send-email',
  },
  context: {},
  payload,
  payloadFieldSources: {
    recipient: 'recipient',
    templateId: 'templateId',
    'dynamicTemplateData.first_name': 'givenName',
    'dynamicTemplateData.last_name': 'familyName',
  },
});

describe('SendgridEmailConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a successful send and sends the dynamic-template payload without subject, text, or html', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    mockedSgMail.send.mockResolvedValueOnce({} as never);

    const result = await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': 'Ada',
        'dynamicTemplateData.last_name': 'Lovelace',
      }),
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted());
    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('sg-test-key');
    expect(mockedSgMail.send).toHaveBeenCalledTimes(1);
    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      from: 'sender@example.com',
      templateId: 'd-template-id',
      dynamicTemplateData: {
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    });
  });

  it('omits dynamicTemplateData when no dynamic-template variables are provided', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    mockedSgMail.send.mockResolvedValueOnce({} as never);

    await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
      }),
    );

    expect(mockedSgMail.send).toHaveBeenCalledTimes(1);
    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      from: 'sender@example.com',
      templateId: 'd-template-id',
    });
  });

  it.each([
    ['blank recipient', { recipient: '   ', templateId: 'd-template-id' }],
    ['missing recipient', { templateId: 'd-template-id' }],
    ['non-string recipient', { recipient: 42, templateId: 'd-template-id' }],
    ['blank templateId', { recipient: 'recipient@example.com', templateId: '   ' }],
    ['missing templateId', { recipient: 'recipient@example.com' }],
    ['non-string templateId', { recipient: 'recipient@example.com', templateId: 42 }],
  ])('returns invalid for %s without sending', async (_label, payload) => {
    const connector = new SendgridEmailConnector(createSettingsService());

    await expect(connector.execute(createInput(payload))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('returns invalid for a bare dynamic-template mapping key without sending', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    await expect(
      connector.execute(
        createInput({
          recipient: 'recipient@example.com',
          templateId: 'd-template-id',
          dynamicTemplateData: 'Ada',
        }),
      ),
    ).resolves.toEqual(ConnectorExecutionResult.invalid());
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it.each([
    [
      'malformed dynamic-template mapping key',
      {
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.user.name': 'Ada',
      },
    ],
    [
      'empty dynamic-template variable name',
      {
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.': 'Ada',
      },
    ],
    [
      'blank dynamic-template mapped value',
      {
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': '   ',
      },
    ],
    [
      'null dynamic-template mapped value',
      {
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': null,
      },
    ],
    [
      'undefined dynamic-template mapped value',
      {
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': undefined,
      },
    ],
  ])('returns invalid for %s without sending', async (_label, payload) => {
    const connector = new SendgridEmailConnector(createSettingsService());

    await expect(connector.execute(createInput(payload))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('returns retryable invalid-data for malformed recipients without sending', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    const result = await connector.execute(
      createInput({
        recipient: 'not-an-email',
        templateId: 'd-template-id',
      }),
    );

    expect(result).toEqual(
      ConnectorExecutionResult.invalidData(
        { recipient: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('returns retryable invalid-data for template IDs that do not start with d-', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    const result = await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        templateId: 'template-id',
      }),
    );

    expect(result).toEqual(
      ConnectorExecutionResult.invalidData(
        { templateId: ['INVALID'] },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('returns combined retryable invalid-data when recipient and template ID are both malformed', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    const result = await connector.execute(
      createInput({
        recipient: 'not-an-email',
        templateId: 'template-id',
      }),
    );

    expect(result).toEqual(
      ConnectorExecutionResult.invalidData(
        {
          recipient: ['INVALID'],
          templateId: ['INVALID'],
        },
        {
          [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
        },
      ),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('accepts number and boolean dynamic-template values and trims string values before sending', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());

    mockedSgMail.send.mockResolvedValueOnce({} as never);

    const result = await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': ' Ada ',
        'dynamicTemplateData.number_of_items': 42,
        'dynamicTemplateData.is_active': true,
      }),
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted());
    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      from: 'sender@example.com',
      templateId: 'd-template-id',
      dynamicTemplateData: {
        first_name: 'Ada',
        number_of_items: 42,
        is_active: true,
      },
    });
  });

  it('wraps send failures in a safe unavailable exception without leaking provider details', async () => {
    const connector = new SendgridEmailConnector(createSettingsService());
    const providerMessage =
      'Provider exploded for recipient recipient@example.com and key sg-test-key';
    const templateId = 'd-template-id';
    const mappedValue = 'Ada';

    mockedSgMail.send.mockRejectedValueOnce(new Error(providerMessage));

    const error = await connector
      .execute(
        createInput({
          recipient: 'recipient@example.com',
          templateId,
          'dynamicTemplateData.first_name': mappedValue,
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendgridEmailUnavailableException);

    const unavailableError = error as SendgridEmailUnavailableException;
    expect(unavailableError.getResponse()).toEqual({
      code: 'SENDGRID_EMAIL_UNAVAILABLE',
      message: 'SENDGRID_EMAIL_UNAVAILABLE',
    });
    expect(JSON.stringify(unavailableError)).not.toContain(providerMessage);
    expect(JSON.stringify(unavailableError)).not.toContain('sg-test-key');
    expect(JSON.stringify(unavailableError)).not.toContain('recipient@example.com');
    expect(JSON.stringify(unavailableError)).not.toContain(templateId);
    expect(JSON.stringify(unavailableError)).not.toContain(mappedValue);
    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('sg-test-key');
  });

  it('uses a stored credential resolved through the settings service', async () => {
    const settingsService = createSettingsService({
      apiKey: 'stored-api-key',
      from: 'stored-sender@example.com',
    });
    const connector = new SendgridEmailConnector(settingsService);

    mockedSgMail.send.mockResolvedValueOnce({} as never);

    await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        templateId: 'd-template-id',
      }),
    );

    expect(settingsService.resolve).toHaveBeenCalledWith(connector);
    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('stored-api-key');
    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      from: 'stored-sender@example.com',
      templateId: 'd-template-id',
    });
  });

  it('surfaces an unresolvable required credential as ConnectorNotConfiguredException, not the provider-unavailable exception', async () => {
    const connector = new SendgridEmailConnector(
      createSettingsService({ from: 'sender@example.com' }),
    );

    const error = await connector
      .execute(
        createInput({
          recipient: 'recipient@example.com',
          templateId: 'd-template-id',
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorNotConfiguredException);
    expect(error).not.toBeInstanceOf(SendgridEmailUnavailableException);
    expect(mockedSgMail.send).not.toHaveBeenCalled();
  });

  describe('settingsSchema', () => {
    const fromField = new SendgridEmailConnector(
      createSettingsService(),
    ).settingsSchema.fields.find((field) => field.key === 'from');

    it('accepts a well-formed email address', () => {
      expect(fromField?.pattern?.test('ops@example.com')).toBe(true);
    });

    it('rejects a value that is not an email address', () => {
      expect(fromField?.pattern?.test('not-an-email')).toBe(false);
    });
  });
});
