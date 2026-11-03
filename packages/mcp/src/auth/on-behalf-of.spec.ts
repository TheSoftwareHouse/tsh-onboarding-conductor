import { InteractionRequiredAuthError, type AuthenticationResult } from '@azure/msal-node';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import { AuthUnavailableError, TokenRejectedError } from './auth.errors';
import { OnBehalfOfExchanger } from './on-behalf-of';

const ENGINE_SCOPE = 'api://engine-app/.default';
const TOKEN_LIFETIME_MS = 60 * MILLISECONDS_PER_MINUTE;

describe('OnBehalfOfExchanger', () => {
  const acquireTokenOnBehalfOf = jest.fn<Promise<AuthenticationResult | null>, [object]>();
  let exchanger: OnBehalfOfExchanger;

  function engineResult(
    accessToken: string,
    expiresInMs = TOKEN_LIFETIME_MS,
  ): AuthenticationResult {
    return { accessToken, expiresOn: new Date(Date.now() + expiresInMs) } as AuthenticationResult;
  }

  beforeEach(() => {
    exchanger = new OnBehalfOfExchanger({
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      engineScope: ENGINE_SCOPE,
      client: { acquireTokenOnBehalfOf },
    });
  });

  it('requests the engine scope on behalf of the incoming token', async () => {
    acquireTokenOnBehalfOf.mockResolvedValue(engineResult('engine-token'));

    await expect(exchanger.exchange('incoming')).resolves.toBe('engine-token');
    expect(acquireTokenOnBehalfOf).toHaveBeenCalledWith({
      oboAssertion: 'incoming',
      scopes: [ENGINE_SCOPE],
    });
  });

  it('serves a second call with the same incoming token from the cache', async () => {
    acquireTokenOnBehalfOf.mockResolvedValue(engineResult('engine-token'));

    await exchanger.exchange('incoming');
    await expect(exchanger.exchange('incoming')).resolves.toBe('engine-token');

    expect(acquireTokenOnBehalfOf).toHaveBeenCalledTimes(1);
  });

  it('never shares a cached engine token between different incoming tokens', async () => {
    acquireTokenOnBehalfOf
      .mockResolvedValueOnce(engineResult('engine-token-alice'))
      .mockResolvedValueOnce(engineResult('engine-token-bob'));

    await expect(exchanger.exchange('alice-token')).resolves.toBe('engine-token-alice');
    await expect(exchanger.exchange('bob-token')).resolves.toBe('engine-token-bob');
    await expect(exchanger.exchange('alice-token')).resolves.toBe('engine-token-alice');

    expect(acquireTokenOnBehalfOf).toHaveBeenCalledTimes(2);
  });

  it('exchanges again once the cached engine token is within a minute of expiry', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      acquireTokenOnBehalfOf
        .mockResolvedValueOnce(engineResult('first'))
        .mockResolvedValueOnce(engineResult('second'));

      await exchanger.exchange('incoming');
      jest.setSystemTime(Date.now() + TOKEN_LIFETIME_MS - MILLISECONDS_PER_MINUTE / 2);

      await expect(exchanger.exchange('incoming')).resolves.toBe('second');
      expect(acquireTokenOnBehalfOf).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps a consent or step-up requirement to a rejected token', async () => {
    acquireTokenOnBehalfOf.mockRejectedValue(
      new InteractionRequiredAuthError('invalid_grant', 'consent required'),
    );

    await expect(exchanger.exchange('incoming')).rejects.toThrow(TokenRejectedError);
  });

  it('maps an unreachable Entra to unavailable', async () => {
    acquireTokenOnBehalfOf.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(exchanger.exchange('incoming')).rejects.toThrow(AuthUnavailableError);
  });

  it('maps an empty MSAL answer to unavailable and caches nothing', async () => {
    acquireTokenOnBehalfOf.mockResolvedValueOnce(null).mockResolvedValueOnce(engineResult('ok'));

    await expect(exchanger.exchange('incoming')).rejects.toThrow(AuthUnavailableError);
    await expect(exchanger.exchange('incoming')).resolves.toBe('ok');
  });
});
