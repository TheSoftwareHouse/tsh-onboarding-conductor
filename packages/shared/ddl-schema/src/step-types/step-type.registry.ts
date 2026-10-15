import { failWorkflow } from '../workflow-invalid.error';
import type { WorkflowStepTypeDefinition } from './step-type.port';
import { addressStepTypeDefinition } from './types/address.step-type';
import { connectorCallStepTypeDefinition } from './types/connector-call.step-type';
import { consentsStepTypeDefinition } from './types/consents.step-type';
import { contactDetailsStepTypeDefinition } from './types/contact-details.step-type';
import { creditAssessmentStepTypeDefinition } from './types/credit-assessment.step-type';
import { customStepTypeDefinition } from './types/custom.step-type';
import { decisionStepTypeDefinition } from './types/decision.step-type';
import { documentCaptureStepTypeDefinition } from './types/document-capture.step-type';
import { documentChoiceStepTypeDefinition } from './types/document-choice.step-type';
import { formStepTypeDefinition } from './types/form.step-type';
import { httpCallStepTypeDefinition } from './types/http-call.step-type';
import { identityProfileStepTypeDefinition } from './types/identity-profile.step-type';
import { kycIdentityVerificationStepTypeDefinition } from './types/kyc-identity-verification.step-type';
import { manualReviewStepTypeDefinition } from './types/manual-review.step-type';
import { notifyStepTypeDefinition } from './types/notify.step-type';
import { otpVerifyStepTypeDefinition } from './types/otp-verify.step-type';
import { questionnaireStepTypeDefinition } from './types/questionnaire.step-type';
import { riskScoreStepTypeDefinition } from './types/risk-score.step-type';
import { selfieCaptureStepTypeDefinition } from './types/selfie-capture.step-type';
import { terminalStepTypeDefinition } from './types/terminal.step-type';
import { waitForExternalStepTypeDefinition } from './types/wait-for-external.step-type';

/**
 * The step types compiled into the package, in the order a builder's palette reads best:
 * collection, then verification, then decisions, then integrations and endings. Externally mounted
 * types are added at startup through `registerStepType`, so read the current set with
 * `listStepTypes`, never from this array.
 */
export const BUILT_IN_STEP_TYPES = [
  // Collect.
  formStepTypeDefinition,
  contactDetailsStepTypeDefinition,
  consentsStepTypeDefinition,
  identityProfileStepTypeDefinition,
  addressStepTypeDefinition,
  questionnaireStepTypeDefinition,
  documentChoiceStepTypeDefinition,
  documentCaptureStepTypeDefinition,
  selfieCaptureStepTypeDefinition,
  // Verify.
  otpVerifyStepTypeDefinition,
  kycIdentityVerificationStepTypeDefinition,
  creditAssessmentStepTypeDefinition,
  // Decide.
  decisionStepTypeDefinition,
  riskScoreStepTypeDefinition,
  manualReviewStepTypeDefinition,
  // Integrate, and end.
  httpCallStepTypeDefinition,
  notifyStepTypeDefinition,
  connectorCallStepTypeDefinition,
  waitForExternalStepTypeDefinition,
  customStepTypeDefinition,
  terminalStepTypeDefinition,
] as const satisfies readonly WorkflowStepTypeDefinition[];

export type BuiltInWorkflowStepType = (typeof BUILT_IN_STEP_TYPES)[number]['type'];

/** Widened on purpose: a mounted type contributes a name the compiler cannot know. */
export type WorkflowStepTypeName = BuiltInWorkflowStepType | (string & Record<never, never>);

// A Map, not an object: names come from untrusted workflow JSON and must not reach the prototype.
const stepTypesByName = new Map<string, WorkflowStepTypeDefinition>(
  BUILT_IN_STEP_TYPES.map((definition) => [definition.type, definition]),
);

let stepTypeRegistryVersion = 0;

/** Changes whenever the registry is mutated, so derived artifacts know to rebuild. */
export const getStepTypeRegistryVersion = (): number => stepTypeRegistryVersion;

/**
 * Mounts a step type. Call during startup, before the first workflow is validated; the workflow
 * schema derived from the registry rebuilds on next use.
 */
export const registerStepType = (definition: WorkflowStepTypeDefinition): void => {
  stepTypesByName.set(definition.type, definition);
  stepTypeRegistryVersion += 1;
};

export const findStepType = (typeName: string): WorkflowStepTypeDefinition | undefined =>
  stepTypesByName.get(typeName);

export const getStepType = (typeName: string): WorkflowStepTypeDefinition =>
  findStepType(typeName) ?? failWorkflow('INVALID_VALUE');

/** Every registered step type, built-ins first, in registration order. */
export const listStepTypes = (): readonly WorkflowStepTypeDefinition[] => [
  ...stepTypesByName.values(),
];

export const listStepTypeNames = (): readonly string[] => [...stepTypesByName.keys()];
