import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

interface AuthMail {
  to: string;
  subject: string;
  intro: string;
  linkLabel: string;
  link: string;
}

/** Sends the invitation and password-reset mail better-auth asks for, over `AUTH_SMTP_URL`. */
@Injectable()
export class AuthMailer {
  private transport: Transporter | undefined;

  constructor(private readonly configService: ConfigService) {}

  sendInvitation(to: string, organizationName: string, inviterName: string, link: string) {
    return this.send({
      to,
      subject: `You are invited to ${organizationName}`,
      intro: `${inviterName} invited you to join ${organizationName}.`,
      linkLabel: 'Accept the invitation',
      link,
    });
  }

  sendPasswordReset(to: string, link: string) {
    return this.send({
      to,
      subject: 'Reset your password',
      intro:
        'Someone asked to reset the password of this account. Ignore this message if it was not you.',
      linkLabel: 'Choose a new password',
      link,
    });
  }

  private async send({ to, subject, intro, linkLabel, link }: AuthMail): Promise<void> {
    this.transport ??= createTransport(this.configService.getOrThrow<string>('AUTH_SMTP_URL'));

    await this.transport.sendMail({
      from: this.configService.getOrThrow<string>('AUTH_MAIL_FROM'),
      to,
      subject,
      text: `${intro}\n\n${linkLabel}: ${link}`,
      html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`,
    });
  }
}
