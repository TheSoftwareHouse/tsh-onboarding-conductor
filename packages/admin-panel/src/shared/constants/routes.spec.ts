import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from './routes';

describe('ADMIN_ROUTES', () => {
  it('builds one onboarding’s details path', () => {
    expect(ADMIN_ROUTES.onboardings.details('018f1e2a-aaaa-7000-8000-00000000000a')).toBe(
      '/onboardings/018f1e2a-aaaa-7000-8000-00000000000a',
    );
  });

  it('encodes a value that would otherwise change the shape of the path', () => {
    // Audit rows carry resource ids the panel never generated, so a slash must not become a segment.
    expect(ADMIN_ROUTES.onboardings.details('a/b?c')).toBe('/onboardings/a%2Fb%3Fc');
  });

  it('keeps the details pattern and the built path on the same root', () => {
    expect(ADMIN_ROUTES.onboardings.detailsPattern).toBe('/onboardings/:onboardingId');
    expect(
      ADMIN_ROUTES.onboardings.details('x').startsWith(`${ADMIN_ROUTES.onboardings.root}/`),
    ).toBe(true);
  });
});
