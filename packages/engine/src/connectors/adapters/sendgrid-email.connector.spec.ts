import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { AppConfig } from '../../config/app.config';
import { SendgridEmailUnavailableException } from '../errors/sendgrid-email-unavailable.exception';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../ports/connector-execution-result';
import { SendgridEmailConnector } from './sendgrid-email.connector';

jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

const mockedSgMail = sgMail as jest.Mocked<typeof sgMail>;

const createConfigService = (values: Record<string, string> = {}) =>
  ({
    getOrThrow: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService<AppConfig, true>;

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
    subject: 'subject',
    body: 'body',
  },
});

describe('SendgridEmailConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a successful send and maps the request payload to the SendGrid SDK call', async () => {
    const connector = new SendgridEmailConnector(
      createConfigService({
        SENDGRID_API_KEY: 'sg-test-key',
        SENDGRID_FROM: 'sender@example.com',
      }),
    );

    mockedSgMail.send.mockResolvedValueOnce({} as never);

    const result = await connector.execute(
      createInput({
        recipient: 'recipient@example.com',
        subject: 'Hello',
        body: 'Body',
      }),
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted());
    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('sg-test-key');
    expect(mockedSgMail.send).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      from: 'sender@example.com',
      subject: 'Hello',
      text: 'Body',
    });
  });

  it.each([
    ['blank recipient', { recipient: '   ', subject: 'Hello', body: 'Body' }],
    ['missing recipient', { subject: 'Hello', body: 'Body' }],
    ['blank subject', { recipient: 'recipient@example.com', subject: '   ', body: 'Body' }],
    ['missing subject', { recipient: 'recipient@example.com', body: 'Body' }],
    ['blank body', { recipient: 'recipient@example.com', subject: 'Hello', body: '   ' }],
    ['missing body', { recipient: 'recipient@example.com', subject: 'Hello' }],
  ])('returns invalid for %s without sending', async (_label, payload) => {
    const connector = new SendgridEmailConnector(
      createConfigService({
        SENDGRID_API_KEY: 'sg-test-key',
        SENDGRID_FROM: 'sender@example.com',
      }),
    );

    await expect(connector.execute(createInput(payload))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    expect(mockedSgMail.send).not.toHaveBeenCalled();
    expect(mockedSgMail.setApiKey).not.toHaveBeenCalled();
  });

  it('returns retryable invalid-data for malformed recipients without sending', async () => {
    const connector = new SendgridEmailConnector(
      createConfigService({
        SENDGRID_API_KEY: 'sg-test-key',
        SENDGRID_FROM: 'sender@example.com',
      }),
    );

    const result = await connector.execute(
      createInput({
        recipient: 'not-an-email',
        subject: 'Hello',
        body: 'Body',
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

  it('wraps send failures in a safe unavailable exception without leaking provider details', async () => {
    const connector = new SendgridEmailConnector(
      createConfigService({
        SENDGRID_API_KEY: 'sg-test-key',
        SENDGRID_FROM: 'sender@example.com',
      }),
    );
    const providerMessage =
      'Provider exploded for recipient recipient@example.com and key sg-test-key';

    mockedSgMail.send.mockRejectedValueOnce(new Error(providerMessage));

    const error = await connector
      .execute(
        createInput({
          recipient: 'recipient@example.com',
          subject: 'Hello',
          body: 'Body',
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
    expect(mockedSgMail.setApiKey).toHaveBeenCalledWith('sg-test-key');
  });
});
