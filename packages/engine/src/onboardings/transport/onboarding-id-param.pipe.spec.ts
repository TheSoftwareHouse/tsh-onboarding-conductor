import { OnboardingNotFoundException } from '../errors/onboarding-not-found.exception';
import { OnboardingIdParamPipe } from './onboarding-id-param.pipe';

describe('OnboardingIdParamPipe', () => {
  const pipe = new OnboardingIdParamPipe();

  it('passes through valid UUID onboarding ids', () => {
    const validOnboardingId = '01900000-0000-7000-8000-000000000001';

    expect(pipe.transform(validOnboardingId)).toBe(validOnboardingId);
  });

  it('maps malformed onboarding ids to the stable not-found contract exception', () => {
    expect(() => pipe.transform('not-a-uuid')).toThrow(OnboardingNotFoundException);
  });
});
