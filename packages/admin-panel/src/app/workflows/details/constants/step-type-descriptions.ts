import { STEP_TYPE, type StepTypeName } from '@tsh/ddl-schema/step-types';

/** What each step type does, short enough for two palette lines. */
const STEP_TYPE_DESCRIPTIONS: Record<StepTypeName, string> = {
  [STEP_TYPE.form]: 'Collects fields you define, when no other step fits.',
  [STEP_TYPE.contactDetails]: 'Collects email and phone; each can be optional.',
  [STEP_TYPE.consents]: 'Collects consent to terms, privacy and marketing.',
  [STEP_TYPE.identityProfile]: 'Collects name, date of birth and nationality.',
  [STEP_TYPE.address]: 'Collects a postal address in allowed countries.',
  [STEP_TYPE.questionnaire]: 'Asks preset KYC questions, grouped in sections.',
  [STEP_TYPE.documentChoice]: 'Applicant picks an ID document; a port per type.',
  [STEP_TYPE.documentCapture]: 'Uploads an ID document, one side or both.',
  [STEP_TYPE.selfieCapture]: 'Uploads a selfie of the applicant.',
  [STEP_TYPE.otpVerify]: 'Sends a code by SMS or email and checks it.',
  [STEP_TYPE.kycIdentityVerification]: 'Checks identity with a KYC provider, with retries.',
  [STEP_TYPE.decision]: 'Routes to a port by conditions on collected fields.',
  [STEP_TYPE.riskScore]: 'Adds up scoring rules and routes by score band.',
  [STEP_TYPE.manualReview]: 'Waits for an operator to approve or reject.',
  [STEP_TYPE.httpCall]: 'Calls an HTTP endpoint, maps the response.',
  [STEP_TYPE.notify]: "Messages a field's address through a connector.",
  [STEP_TYPE.connectorCall]: 'Calls connectors; can route to rejected.',
  [STEP_TYPE.waitForExternal]: 'Pauses until an outside system sends its fields.',
  [STEP_TYPE.custom]: 'A hand-written compiled step, for edge cases.',
  [STEP_TYPE.terminal]: 'Ends the onboarding: approved, rejected, invalid.',
};

/** The description of a step type, or `undefined` for a type the panel does not know. */
export function findStepTypeDescription(type: string): string | undefined {
  return Object.hasOwn(STEP_TYPE_DESCRIPTIONS, type)
    ? STEP_TYPE_DESCRIPTIONS[type as StepTypeName]
    : undefined;
}
