import { randomUUID } from 'node:crypto';

export type ProviderInitiation<TDetail> = Readonly<{
  providerReference: string;
  onboardingId: string;
  connectorOrder: number;
  detail: TDetail;
}>;

export type ProviderCallbackFixture = Readonly<{
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
}>;

/**
 * The provider side of an asynchronous connector: what a mock remembers when the engine parks
 * a step, and how a test speaks for the provider afterwards. Correlation lives here rather
 * than in the callback body, because a real provider echoes its own reference and never the
 * engine's onboarding id — the parsing below refuses a body that tries to.
 */
export class ProviderCallbackStore<TDetail> {
  private readonly initiations = new Map<string, ProviderInitiation<TDetail>>();
  private readonly latestByOnboarding = new Map<string, string>();

  record(
    input: Readonly<{ onboardingId: string; connectorOrder: number; detail: TDetail }>,
  ): ProviderInitiation<TDetail> {
    const initiation: ProviderInitiation<TDetail> = {
      providerReference: randomUUID(),
      onboardingId: input.onboardingId,
      connectorOrder: input.connectorOrder,
      detail: input.detail,
    };

    this.initiations.set(initiation.providerReference, initiation);
    this.latestByOnboarding.set(input.onboardingId, initiation.providerReference);

    return initiation;
  }

  resolve(providerReference: string): ProviderInitiation<TDetail> | undefined {
    return this.initiations.get(providerReference);
  }

  peekLatest(onboardingId: string): ProviderInitiation<TDetail> | undefined {
    const providerReference = this.latestByOnboarding.get(onboardingId);

    return providerReference ? this.initiations.get(providerReference) : undefined;
  }

  buildCallback(
    payload: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string | undefined>> = {},
  ): ProviderCallbackFixture {
    return {
      rawBody: new TextEncoder().encode(JSON.stringify(payload)),
      headers: { ...headers },
    };
  }

  parseCallback(rawBody: Uint8Array): Record<string, unknown> {
    if (rawBody.byteLength === 0) {
      throw new Error('Callback body is required');
    }

    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      throw new Error('Callback body must be valid UTF-8');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error('Callback body must be valid JSON');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Callback JSON body must be an object');
    }

    const payload = parsed as Record<string, unknown>;

    if (
      Object.prototype.hasOwnProperty.call(payload, 'onboardingId') ||
      Object.prototype.hasOwnProperty.call(payload, 'connectorOrder')
    ) {
      throw new Error('Callback payload contains forbidden correlation fields');
    }

    return payload;
  }

  requireInitiation(payload: Readonly<Record<string, unknown>>): ProviderInitiation<TDetail> {
    const providerReference = payload.providerReference;

    if (typeof providerReference !== 'string' || providerReference.trim() === '') {
      throw new Error('providerReference must be a non-empty string');
    }

    const initiation = this.resolve(providerReference.trim());

    if (!initiation) {
      throw new Error('Unknown provider reference');
    }

    return initiation;
  }

  requireSubmittedData(value: unknown): Record<string, unknown> {
    if (value === undefined) {
      return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('submittedData must be an object');
    }

    return { ...(value as Record<string, unknown>) };
  }

  reset(): void {
    this.initiations.clear();
    this.latestByOnboarding.clear();
  }
}
