import type { OtpChallengesConnection } from '../../otp-challenges.connection';
import { ConnectorNotConfiguredException } from '../../errors/connector-not-configured.exception';
import { OtpDeliveryFailedException } from '../../errors/otp-delivery-failed.exception';
import type { OtpChallengesRepository } from '../../otp-challenges.repository';
import type { ConnectorExecutionInput } from '../../ports/connector-adapter.port';
import { ConnectorExecutionMetadataFlag } from '../../ports/connector-execution-result';
import type { SmtpConnector, SmtpSendOutcome } from './smtp.connector';
import {
  OTP_EMAIL_SUBJECT,
  OTP_EMAIL_TEMPLATE_PATH,
  SmtpEmailOtpConnector,
} from './smtp-email-otp.connector';

const RECIPIENT = 'user@example.com';
const RENDERED = '<p>Your code</p>';

const createConnector = (outcome: SmtpSendOutcome) => {
  const sendMail = jest.fn().mockResolvedValue(outcome);
  const renderBody = jest.fn<string | undefined, unknown[]>().mockReturnValue(RENDERED);
  const repository = {
    find: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue({}),
  };
  const connector = new SmtpEmailOtpConnector(
    { getManager: async () => ({}) } as unknown as OtpChallengesConnection,
    repository as unknown as OtpChallengesRepository,
    { id: 'smtp', sendMail, renderBody } as unknown as SmtpConnector,
  );

  return { connector, sendMail, renderBody, repository };
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
    const { connector } = createConnector({ status: 'sent' });

    expect(connector).toMatchObject({
      id: 'smtp_email_otp',
      name: 'smtp_email_otp',
      type: 'otp_verification',
      channel: 'email',
    });
    expect(connector).not.toHaveProperty('settingsSchema');
  });

  it('renders the built-in template with the code and sends it to the recipient', async () => {
    const { connector, sendMail, renderBody, repository } = createConnector({ status: 'sent' });

    expect((await connector.execute(send())).isAccepted()).toBe(true);

    expect(renderBody).toHaveBeenCalledWith(
      { templatePath: OTP_EMAIL_TEMPLATE_PATH },
      { code: expect.stringMatching(/^\d{6}$/) },
    );
    expect(OTP_EMAIL_TEMPLATE_PATH).toBe('built-in/otp-code.html');
    expect(sendMail).toHaveBeenCalledWith({
      recipient: RECIPIENT,
      subject: OTP_EMAIL_SUBJECT,
      html: RENDERED,
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('fails as retryable invalid data on the recipient field for an address SMTP refuses', async () => {
    const { connector, repository } = createConnector({ status: 'invalid_recipient' });

    const result = await connector.execute(send());

    expect(result.isInvalidData()).toBe(true);
    expect(result.errors).toEqual({ email: ['INVALID'] });
    expect(result.metadata).toEqual({
      [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws ConnectorNotConfiguredException naming the key when SMTP is not configured', async () => {
    const { connector, repository } = createConnector({
      status: 'not_configured',
      key: 'SMTP_ENABLED',
    });

    const execution = connector.execute(send());

    await expect(execution).rejects.toBeInstanceOf(ConnectorNotConfiguredException);
    await expect(execution).rejects.toMatchObject({
      response: { code: 'CONNECTOR_NOT_CONFIGURED', connectorId: 'smtp', key: 'SMTP_ENABLED' },
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws OtpDeliveryFailedException when the transport fails, storing nothing', async () => {
    const { connector, repository } = createConnector({ status: 'failed' });

    await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpDeliveryFailedException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('throws OtpDeliveryFailedException without sending when the template does not render', async () => {
    const { connector, sendMail, renderBody } = createConnector({ status: 'sent' });
    renderBody.mockReturnValue(undefined);

    await expect(connector.execute(send())).rejects.toBeInstanceOf(OtpDeliveryFailedException);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
