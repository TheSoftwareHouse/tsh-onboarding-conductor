import { createSerializer, type inferParserType } from 'nuqs';
import { parseAsTrimmedString } from './search-params';

/** The criterion a link into Onboardings narrows by, shared so it uses the page's own param name. */
export const onboardingWorkflowSearchParams = {
  workflowId: parseAsTrimmedString,
};

export type OnboardingWorkflowSearchValues = inferParserType<typeof onboardingWorkflowSearchParams>;

const serialize = createSerializer(onboardingWorkflowSearchParams);

/** Query string opening Onboardings filtered to one workflow, '' when workflowId is null. */
export function serializeOnboardingWorkflowSearch(values: OnboardingWorkflowSearchValues): string {
  return serialize(values);
}
