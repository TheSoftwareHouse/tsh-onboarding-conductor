import { addressStepTypeDefinition } from './types/address.step-type';
import { connectorCallStepTypeDefinition } from './types/connector-call.step-type';
import { consentsStepTypeDefinition } from './types/consents.step-type';
import { contactDetailsStepTypeDefinition } from './types/contact-details.step-type';
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

/** The built-in step-type names, each read from its own definition so the literal lives once. */
export const STEP_TYPE = {
  form: formStepTypeDefinition.type,
  contactDetails: contactDetailsStepTypeDefinition.type,
  consents: consentsStepTypeDefinition.type,
  identityProfile: identityProfileStepTypeDefinition.type,
  address: addressStepTypeDefinition.type,
  questionnaire: questionnaireStepTypeDefinition.type,
  documentChoice: documentChoiceStepTypeDefinition.type,
  documentCapture: documentCaptureStepTypeDefinition.type,
  selfieCapture: selfieCaptureStepTypeDefinition.type,
  otpVerify: otpVerifyStepTypeDefinition.type,
  kycIdentityVerification: kycIdentityVerificationStepTypeDefinition.type,
  decision: decisionStepTypeDefinition.type,
  riskScore: riskScoreStepTypeDefinition.type,
  manualReview: manualReviewStepTypeDefinition.type,
  httpCall: httpCallStepTypeDefinition.type,
  notify: notifyStepTypeDefinition.type,
  connectorCall: connectorCallStepTypeDefinition.type,
  waitForExternal: waitForExternalStepTypeDefinition.type,
  custom: customStepTypeDefinition.type,
  terminal: terminalStepTypeDefinition.type,
} as const;

/** A built-in step-type name; a mounted type's name is not part of it. */
export type StepTypeName = (typeof STEP_TYPE)[keyof typeof STEP_TYPE];
