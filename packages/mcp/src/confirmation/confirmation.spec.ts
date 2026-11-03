import { CallerIdentity } from '../request-context/request-context';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import {
  CONFIRMATION_TOKEN_ARGUMENT,
  CONFIRMATION_TTL_MILLISECONDS,
  ConfirmationError,
  ConfirmationService,
} from './confirmation.service';

const MASKING_KEY = 'k'.repeat(32);
const ANALYST_A: CallerIdentity = { kind: 'user', objectId: 'oid-a', upn: 'a@example.com' };
const ANALYST_B: CallerIdentity = { kind: 'user', objectId: 'oid-b', upn: 'b@example.com' };
const TOOL = 'reconcile_pending_connector';
const ARGS = { onboardingId: 'onb-1', options: { dryRun: false, tags: ['a', 'b'] } };

describe('ConfirmationService', () => {
  let now: number;
  let service: ConfirmationService;

  beforeEach(() => {
    now = Date.parse('2026-01-01T00:00:00Z');
    service = new ConfirmationService(MASKING_KEY, () => now);
  });

  it('accepts a valid token once', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).not.toThrow();
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).toThrow(/already used/);
  });

  it('refuses a token past its expiry and accepts it just before', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    now += CONFIRMATION_TTL_MILLISECONDS - 1;
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).not.toThrow();

    const late = service.issue(ANALYST_A, TOOL, ARGS);
    now += CONFIRMATION_TTL_MILLISECONDS;
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, late)).toThrow(/expired/);
  });

  it('refuses a token issued to another user', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    expect(() => service.consume(ANALYST_B, TOOL, ARGS, token)).toThrow(ConfirmationError);
  });

  it('refuses a token issued for another tool', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    expect(() => service.consume(ANALYST_A, 'create_workflow_draft', ARGS, token)).toThrow(
      ConfirmationError,
    );
  });

  it('refuses changed arguments, including nested ones', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    expect(() =>
      service.consume(ANALYST_A, TOOL, { ...ARGS, onboardingId: 'onb-2' }, token),
    ).toThrow(ConfirmationError);
    expect(() =>
      service.consume(
        ANALYST_A,
        TOOL,
        { ...ARGS, options: { dryRun: true, tags: ['a', 'b'] } },
        token,
      ),
    ).toThrow(ConfirmationError);
    expect(() =>
      service.consume(
        ANALYST_A,
        TOOL,
        { ...ARGS, options: { dryRun: false, tags: ['b', 'a'] } },
        token,
      ),
    ).toThrow(ConfirmationError);
  });

  it('ignores key order at every depth', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    const reordered = { options: { tags: ['a', 'b'], dryRun: false }, onboardingId: 'onb-1' };

    expect(() => service.consume(ANALYST_A, TOOL, reordered, token)).not.toThrow();
  });

  it('does not bind the confirmation token argument itself', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    const withToken = { ...ARGS, [CONFIRMATION_TOKEN_ARGUMENT]: token };

    expect(() => service.consume(ANALYST_A, TOOL, withToken, token)).not.toThrow();
  });

  it('refuses a tampered, malformed or missing token', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    const [, mac] = token.split('.');
    const extended = `${now + CONFIRMATION_TTL_MILLISECONDS + MILLISECONDS_PER_MINUTE}.${mac}`;

    expect(() => service.consume(ANALYST_A, TOOL, ARGS, extended)).toThrow(ConfirmationError);
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, 'nonsense')).toThrow(ConfirmationError);
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, `${now}.`)).toThrow(ConfirmationError);
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, undefined)).toThrow(ConfirmationError);
  });

  it('refuses every non-canonical spelling of a used token', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    const [expiry, mac] = token.split('.');
    service.consume(ANALYST_A, TOOL, ARGS, token);

    const variants = [`0${token}`, `+${token}`, `${token}=`, `${expiry}x.${mac}`];

    for (const variant of variants) {
      expect(() => service.consume(ANALYST_A, TOOL, ARGS, variant)).toThrow(ConfirmationError);
    }
  });

  it('keys a spent token by its canonical form, so a zero-padded copy is already used', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    service.consume(ANALYST_A, TOOL, ARGS, token);

    expect(() => service.consume(ANALYST_A, TOOL, ARGS, `0${token}`)).toThrow(/already used/);
  });

  it('refuses a token signed under another masking key', () => {
    const other = new ConfirmationService('o'.repeat(32), () => now);
    const token = other.issue(ANALYST_A, TOOL, ARGS);

    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).toThrow(ConfirmationError);
  });

  it('does not spend a token on a refused call', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);

    expect(() => service.consume(ANALYST_B, TOOL, ARGS, token)).toThrow(ConfirmationError);
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).not.toThrow();
  });

  it('forgets used tokens once they have expired', () => {
    const token = service.issue(ANALYST_A, TOOL, ARGS);
    service.consume(ANALYST_A, TOOL, ARGS, token);

    now += CONFIRMATION_TTL_MILLISECONDS;
    service.issue(ANALYST_A, TOOL, ARGS);
    expect(() => service.consume(ANALYST_A, TOOL, ARGS, token)).toThrow(/expired/);
    expect(Reflect.get(service, 'usedTokens').size).toBe(0);
  });
});
