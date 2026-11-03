import { MILLISECONDS_PER_SECOND } from '../time.constants';

const OTP_POLL_INTERVAL_MS = MILLISECONDS_PER_SECOND / 5;
const OTP_WAIT_TIMEOUT_MS = 15 * MILLISECONDS_PER_SECOND;
const OTP_CODE_PATTERN = /\b(\d{6})\b/;

interface MailhogSearchResponse {
  items: Array<{ ID: string; Content: { Body: string } }>;
}

/** Reads the one-time codes the engine emails, from MailHog's HTTP API. */
export class MailhogClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** The ids of the messages already addressed to `email`; a rerun leaves older ones behind. */
  async listMessageIds(email: string): Promise<Set<string>> {
    const messages = await this.search(email);

    return new Set(messages.items.map((message) => message.ID));
  }

  /** The six-digit code of the first message to `email` that is not among `knownIds`. */
  async waitForOtpCode(email: string, knownIds: ReadonlySet<string>): Promise<string> {
    const deadline = Date.now() + OTP_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const messages = await this.search(email);
      const fresh = messages.items.find((message) => !knownIds.has(message.ID));
      const code = fresh?.Content.Body.match(OTP_CODE_PATTERN)?.[1];

      if (code) {
        return code;
      }

      await new Promise((resolve) => setTimeout(resolve, OTP_POLL_INTERVAL_MS));
    }

    throw new Error(
      `No new email code reached MailHog for ${email} within ${OTP_WAIT_TIMEOUT_MS} ms.`,
    );
  }

  private async search(email: string): Promise<MailhogSearchResponse> {
    const url = `${this.baseUrl}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MailHog answered ${response.status} to ${url}.`);
    }

    return (await response.json()) as MailhogSearchResponse;
  }
}
