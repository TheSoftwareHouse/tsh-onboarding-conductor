import { buildInvitationLink } from './invitation-link';

const ORIGINS = { engineUrl: 'https://engine.tsh.io', panelOrigin: 'http://localhost:5173' };

describe('buildInvitationLink', () => {
  it('sends the invitee to the panel the inviter used, when it is served apart from the engine', () => {
    expect(buildInvitationLink('inv-1', 'http://localhost:5173', ORIGINS)).toBe(
      'http://localhost:5173/accept-invitation/inv-1',
    );
  });

  it('sends the invitee to the engine when the inviter used the panel the engine serves', () => {
    expect(buildInvitationLink('inv-1', 'https://engine.tsh.io', ORIGINS)).toBe(
      'https://engine.tsh.io/accept-invitation/inv-1',
    );
  });

  it.each([
    ['no Origin, as for an invite sent server-side', undefined],
    ['a null Origin', null],
    ['an Origin the engine does not trust', 'https://evil.example.com'],
    ['a look-alike of the panel origin', 'http://localhost:5173.evil.io'],
  ])('falls back to the engine for %s', (_label, origin) => {
    expect(buildInvitationLink('inv-1', origin, ORIGINS)).toBe(
      'https://engine.tsh.io/accept-invitation/inv-1',
    );
  });

  it('keeps a path the engine is served under, and drops its trailing slash', () => {
    expect(
      buildInvitationLink('inv-1', undefined, { ...ORIGINS, engineUrl: 'https://tsh.io/engine/' }),
    ).toBe('https://tsh.io/engine/accept-invitation/inv-1');
  });

  it('escapes the id, so it cannot change the path', () => {
    expect(buildInvitationLink('a/../b?x', undefined, ORIGINS)).toBe(
      'https://engine.tsh.io/accept-invitation/a%2F..%2Fb%3Fx',
    );
  });
});
