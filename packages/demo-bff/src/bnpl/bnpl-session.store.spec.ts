import { BnplSessionStore, EVENT_RETENTION_MS } from './bnpl-session.store';

describe('BnplSessionStore', () => {
  let store: BnplSessionStore;

  beforeEach(() => {
    store = new BnplSessionStore();
  });

  it('issues a 128-bit base64url token bound to the onboarding and persona', () => {
    const token = store.create('o1', 'sherlock_holmes');

    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(store.get(token)).toMatchObject({ onboardingId: 'o1', persona: 'sherlock_holmes' });
    expect(store.get(token)?.createdAt).toBeInstanceOf(Date);
  });

  it('accepts a session without a persona and lets the bank login set one later', () => {
    const token = store.create('o1', null);

    expect(store.get(token)?.persona).toBeNull();

    const session = store.get(token);
    if (session !== undefined) {
      session.persona = 'james_watson';
    }

    expect(store.get(token)?.persona).toBe('james_watson');
  });

  it('issues a distinct token per session', () => {
    expect(store.create('o1', 'p')).not.toBe(store.create('o2', 'p'));
  });

  it('finds a session by onboarding id and misses an unknown one', () => {
    const token = store.create('o1', 'p');

    expect(store.findByOnboardingId('o1')).toBe(store.get(token));
    expect(store.findByOnboardingId('nope')).toBeUndefined();
    expect(store.get('nope')).toBeUndefined();
  });

  it('grants a webhook event claim once', () => {
    expect(store.claimEvent('e1')).toBe(true);
    expect(store.claimEvent('e1')).toBe(false);
    expect(store.claimEvent('e2')).toBe(true);
  });

  it('forgets a claim after the retention window', () => {
    expect(store.claimEvent('e1', 0)).toBe(true);
    expect(store.claimEvent('e1', EVENT_RETENTION_MS - 1)).toBe(false);
    expect(store.claimEvent('e1', EVENT_RETENTION_MS)).toBe(true);
  });
});
