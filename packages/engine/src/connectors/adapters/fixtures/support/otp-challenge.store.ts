type MockOtpChallengeRejectionReason =
  'ATTEMPTS_EXHAUSTED' | 'CHALLENGE_EXPIRED' | 'CHALLENGE_NOT_FOUND';

type MockOtpChallengeOutcome =
  | { status: 'accepted' }
  | { status: 'invalid' }
  | {
      status: 'invalid-data';
      errors: Readonly<Record<string, readonly string[]>>;
    }
  | {
      status: 'rejected';
      reason: MockOtpChallengeRejectionReason;
    };

type OtpChallenge = {
  code: string;
  expiresAtEpochMs: number;
  attempts: number;
};

export class OtpChallengeStore {
  private readonly challenges = new Map<string, OtpChallenge>();
  private now: () => number = () => Date.now();

  constructor(private readonly connectorType: string) {}

  setNowProviderForTests(nowProvider: () => number): void {
    this.now = nowProvider;
  }

  resetForTests(): void {
    this.challenges.clear();
    this.now = () => Date.now();
  }

  /** Without a channel, answers with the onboarding's challenge on whichever channel holds one. */
  peekCodeForTests(onboardingId: string, channel?: string): string | undefined {
    if (channel !== undefined) {
      return this.challenges.get(this.key(onboardingId, channel))?.code;
    }

    for (const [key, challenge] of this.challenges) {
      if (key.endsWith(`:${onboardingId}`)) {
        return challenge.code;
      }
    }

    return undefined;
  }

  generateCode(
    onboardingId: string,
    payload: Readonly<Record<string, unknown>>,
    config: Readonly<Record<string, unknown>>,
  ): MockOtpChallengeOutcome {
    const recipient = payload.recipient;
    const channel = config.channel;
    const codeLength = config.codeLength;
    const ttlSeconds = config.ttlSeconds;
    const isPositiveInteger = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value > 0;

    if (
      typeof recipient !== 'string' ||
      recipient.trim().length === 0 ||
      typeof channel !== 'string' ||
      !isPositiveInteger(codeLength) ||
      !isPositiveInteger(ttlSeconds)
    ) {
      return { status: 'invalid' };
    }

    this.challenges.set(this.key(onboardingId, channel), {
      code: this.createDeterministicCode(this.key(onboardingId, channel), codeLength),
      expiresAtEpochMs: this.now() + ttlSeconds * 1000,
      attempts: 0,
    });

    return { status: 'accepted' };
  }

  verifyCode(
    onboardingId: string,
    payload: Readonly<Record<string, unknown>>,
    config: Readonly<Record<string, unknown>>,
  ): MockOtpChallengeOutcome {
    const providedCode = payload.code;
    const maxAttempts = config.maxAttempts;
    const channel = config.channel;
    const codeField = config.codeField;
    const isPositiveInteger = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value > 0;

    if (
      typeof providedCode !== 'string' ||
      providedCode.trim().length === 0 ||
      typeof channel !== 'string' ||
      typeof codeField !== 'string' ||
      !isPositiveInteger(maxAttempts)
    ) {
      return { status: 'invalid' };
    }

    const key = this.key(onboardingId, channel);
    const challenge = this.challenges.get(key);

    if (!challenge) {
      return { status: 'rejected', reason: 'CHALLENGE_NOT_FOUND' };
    }

    if (challenge.expiresAtEpochMs <= this.now()) {
      this.challenges.delete(key);
      return { status: 'rejected', reason: 'CHALLENGE_EXPIRED' };
    }

    if (challenge.code === providedCode) {
      this.challenges.delete(key);
      return { status: 'accepted' };
    }

    challenge.attempts += 1;
    if (challenge.attempts >= maxAttempts) {
      this.challenges.delete(key);
      return { status: 'rejected', reason: 'ATTEMPTS_EXHAUSTED' };
    }

    return {
      status: 'invalid-data',
      errors: { [codeField]: ['INVALID'] },
    };
  }

  private key(onboardingId: string, channel: string): string {
    return `${this.connectorType}:${channel}:${onboardingId}`;
  }

  private createDeterministicCode(seed: string, codeLength: number): string {
    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }

    let code = '';
    for (let index = 0; index < codeLength; index += 1) {
      hash = (hash * 1103515245 + 12345) >>> 0;
      code += String(hash % 10);
    }

    return code;
  }
}
