import type { OtpChallengesConnection } from '../../otp-challenges.connection';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import type { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import type { SmtpConnector } from './smtp.connector';
import {
  OTP_EMAIL_SUBJECT,
  OTP_EMAIL_TEMPLATE_PATH,
  SmtpEmailOtpConnector,
} from './smtp-email-otp.connector';

const RECIPIENT = 'user@example.com';

const createConnector = (result: ConnectorExecutionResult) => {
  const execute = jest.fn().mockResolvedValue(result);
  const repository = {
    find: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue({}),
  };
  const connector = new SmtpEmailOtpConnector(
    { getManager: async () => ({}) } as unknown as OtpChallengesConnection,
    repository as unknown as OtpChallengesRepository,
    { execute } as unknown as SmtpConnector,
  );

  return { connector, execute, repository };
};

const send = (): ConnectorExecutionInput => ({
  declaration: { order: 0, config: { operation: 'send', channel: 'email' } },
  execution: { onboardingId: 'onb-1', stepName: 'send_code' },
  context: {},
  payload: { recipient: RECIPIENT },
  payloadFieldSources: { recipient: 'email' },
});

describe('SmtpEmailOtpConnector', () => {
  it('is an email otp_verification connector with no settings of its own', () => {
    const { connector } = createConnector(ConnectorExecutionResult.accepted());

    expect(connector).toMatchObject({
      id: 'smtp_email_otp',
      name: 'smtp_email_otp',
      type: 'otp_verification',
      channel: 'email',
    });
    expect(connector).not.toHaveProperty('settingsSchema');
  });

  it('hands SmtpConnector the recipient, subject, code and the built-in template', async () => {
    const { connector, execute, repository } = createConnector(ConnectorExecutionResult.accepted());

    expect((await connector.execute(send())).isAccepted()).toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    const input = execute.mock.calls[0][0];
    expect(input.payload).toEqual({
      recipient: RECIPIENT,
      subject: OTP_EMAIL_SUBJECT,
      code: expect.stringMatching(/^\d{6}$/),
    });
    expect(input.declaration.config).toEqual({ templatePath: OTP_EMAIL_TEMPLATE_PATH });
    expect(OTP_EMAIL_TEMPLATE_PATH).toBe('built-in/otp-code.html');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejected', ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')],
    ['invalid-data', ConnectorExecutionResult.invalidData({ recipient: ['INVALID'] })],
    ['invalid', ConnectorExecutionResult.invalid()],
  ])('throws OtpDeliveryFailedException on a %s result, storing nothing', async (_name, result) => {
    const { connector, repository } = createConnector(result);

    await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpDeliveryFailedException);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
