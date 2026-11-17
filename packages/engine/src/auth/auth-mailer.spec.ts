import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { AuthMailer } from './auth-mailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('AuthMailer', () => {
  const sendMail = jest.fn();
  const createMailer = () => {
    jest.mocked(createTransport).mockReturnValue({ sendMail } as never);
    const config = new ConfigService({
      AUTH_SMTP_URL: 'smtp://mailhog:1025',
      AUTH_MAIL_FROM: 'no-reply@example.test',
    });

    return new AuthMailer(config);
  };

  it('sends an invitation with the link in both the text and the HTML part', async () => {
    const link = 'http://localhost:3000/accept-invitation/inv-1';

    await createMailer().sendInvitation('invitee@example.test', 'Acme <HR>', 'Ada', link);

    expect(createTransport).toHaveBeenCalledWith('smtp://mailhog:1025');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@example.test',
        to: 'invitee@example.test',
        subject: 'You are invited to Acme <HR>',
        text: expect.stringContaining(link),
        html: expect.stringContaining(`href="${link}"`),
      }),
    );
    expect(sendMail.mock.calls[0][0].html).toContain('Acme &lt;HR&gt;');
  });

  it('sends a password reset and reuses one transport', async () => {
    const mailer = createMailer();

    await mailer.sendPasswordReset('a@example.test', 'http://x/reset?token=t');
    await mailer.sendPasswordReset('b@example.test', 'http://x/reset?token=u');

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'a@example.test',
      subject: 'Reset your password',
      text: expect.stringContaining('http://x/reset?token=t'),
    });
  });
});
