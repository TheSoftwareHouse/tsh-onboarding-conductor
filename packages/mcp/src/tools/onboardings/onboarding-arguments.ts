import { ToolError } from '../tool-error';
import type { ToolArguments } from '../tool-registration';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The required `onboardingId` argument, which must be the UUID the engine issued. */
export function getOnboardingId(args: ToolArguments): string {
  const value = args.onboardingId;

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ToolError(
      'onboardingId is required and must be an onboarding UUID, as find_onboardings returns it.',
    );
  }

  return value;
}
