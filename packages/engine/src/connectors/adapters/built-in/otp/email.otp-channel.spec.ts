import { OtpDeliveryFailedException } from '../../../errors/otp-delivery-failed.exception';
import { ConnectorExecutionResult } from '../../../ports/connector-execution-result';
import type { SmtpConnector } from '../smtp.connector';
import { EmailOtpChannel, OTP_EMAIL_SUBJECT, OTP_EMAIL_TEMPLATE_PATH } from './email.otp-channel';

const RECIPIENT = 'user@example.com';
const CODE = '123456';

const createChannel = (result: ConnectorExecutionResult) => {
  const execute = jest.fn().mockResolvedValue(result);
  const channel = new EmailOtpChannel({ execute } as unknown as SmtpConnector);

  return { channel, execute };
};

describe('EmailOtpChannel', () => {
  it('declares the email channel with no settings of its own', () => {
    const { channel } = createChannel(ConnectorExecutionResult.accepted());

    expect(channel.channel).toBe('email');
    expect(channel.settingsFields).toEqual([]);
  });

  it('hands SmtpConnector the recipient, subject, code and the built-in template', async () => {
    const { channel, execute } = createChannel(ConnectorExecutionResult.accepted());

    await channel.send(RECIPIENT, CODE);

    expect(execute).toHaveBeenCalledTimes(1);
    const input = execute.mock.calls[0][0];
    expect(input.payload).toEqual({ recipient: RECIPIENT, subject: OTP_EMAIL_SUBJECT, code: CODE });
    expect(input.declaration.config).toEqual({ templatePath: OTP_EMAIL_TEMPLATE_PATH });
    expect(OTP_EMAIL_TEMPLATE_PATH).toBe('built-in/otp-code.html');
  });

  it.each([
    ['rejected', ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')],
    ['invalid-data', ConnectorExecutionResult.invalidData({ recipient: ['INVALID'] })],
    ['invalid', ConnectorExecutionResult.invalid()],
  ])('throws OtpDeliveryFailedException on a %s result', async (_name, result) => {
    const { channel } = createChannel(result);

    await expect(channel.send(RECIPIENT, CODE)).rejects.toBeInstanceOf(OtpDeliveryFailedException);
  });
});
