import { failWorkflow } from '../workflow-invalid.error';
import type { WorkflowNodeTypeDefinition } from './node-type.port';
import { addressNodeTypeDefinition } from './types/address.node-type';
import { consentsNodeTypeDefinition } from './types/consents.node-type';
import { customStepNodeTypeDefinition } from './types/custom-step.node-type';
import { decisionNodeTypeDefinition } from './types/decision.node-type';
import { documentCaptureNodeTypeDefinition } from './types/document-capture.node-type';
import { documentChoiceNodeTypeDefinition } from './types/document-choice.node-type';
import { formNodeTypeDefinition } from './types/form.node-type';
import { httpCallNodeTypeDefinition } from './types/http-call.node-type';
import { identityProfileNodeTypeDefinition } from './types/identity-profile.node-type';
import { kycIdentityVerificationNodeTypeDefinition } from './types/kyc-identity-verification.node-type';
import { manualReviewNodeTypeDefinition } from './types/manual-review.node-type';
import { notifyNodeTypeDefinition } from './types/notify.node-type';
import { otpVerifyNodeTypeDefinition } from './types/otp-verify.node-type';

import { questionnaireNodeTypeDefinition } from './types/questionnaire.node-type';
import { riskScoreNodeTypeDefinition } from './types/risk-score.node-type';
import { selfieCaptureNodeTypeDefinition } from './types/selfie-capture.node-type';
import { terminalNodeTypeDefinition } from './types/terminal.node-type';

import { waitForExternalNodeTypeDefinition } from './types/wait-for-external.node-type';

/**
 * The node types compiled into the package, in the order a builder's palette reads best:
 * collection, then verification, then decisions, then integrations and endings. Externally mounted
 * types are added at startup through `registerNodeType`, so read the current set with
 * `listNodeTypes`, never from this array.
 */
export const BUILT_IN_NODE_TYPES = [
  // Collect.
  formNodeTypeDefinition,
  consentsNodeTypeDefinition,
  identityProfileNodeTypeDefinition,
  addressNodeTypeDefinition,
  questionnaireNodeTypeDefinition,
  documentChoiceNodeTypeDefinition,
  documentCaptureNodeTypeDefinition,
  selfieCaptureNodeTypeDefinition,
  // Verify.
  otpVerifyNodeTypeDefinition,
  kycIdentityVerificationNodeTypeDefinition,
  // Decide.
  decisionNodeTypeDefinition,
  riskScoreNodeTypeDefinition,
  manualReviewNodeTypeDefinition,
  // Integrate, and end.
  httpCallNodeTypeDefinition,
  notifyNodeTypeDefinition,
  waitForExternalNodeTypeDefinition,
  customStepNodeTypeDefinition,
  terminalNodeTypeDefinition,
] as const satisfies readonly WorkflowNodeTypeDefinition[];

export type BuiltInWorkflowNodeType = (typeof BUILT_IN_NODE_TYPES)[number]['type'];

/** Widened on purpose: a mounted type contributes a name the compiler cannot know. */
export type WorkflowNodeTypeName = BuiltInWorkflowNodeType | (string & Record<never, never>);

// A Map, not an object: names come from untrusted workflow JSON and must not reach the prototype.
const nodeTypesByName = new Map<string, WorkflowNodeTypeDefinition>(
  BUILT_IN_NODE_TYPES.map((definition) => [definition.type, definition]),
);

let nodeTypeRegistryVersion = 0;

/** Changes whenever the registry is mutated, so derived artifacts know to rebuild. */
export const getNodeTypeRegistryVersion = (): number => nodeTypeRegistryVersion;

/**
 * Mounts a node type. Call during startup, before the first workflow is validated; the node-graph
 * schema derived from the registry rebuilds on next use.
 */
export const registerNodeType = (definition: WorkflowNodeTypeDefinition): void => {
  nodeTypesByName.set(definition.type, definition);
  nodeTypeRegistryVersion += 1;
};

export const findNodeType = (typeName: string): WorkflowNodeTypeDefinition | undefined =>
  nodeTypesByName.get(typeName);

export const getNodeType = (typeName: string): WorkflowNodeTypeDefinition =>
  findNodeType(typeName) ?? failWorkflow('INVALID_VALUE');

/** Every registered node type, built-ins first, in registration order. */
export const listNodeTypes = (): readonly WorkflowNodeTypeDefinition[] => [
  ...nodeTypesByName.values(),
];

export const listNodeTypeNames = (): readonly string[] => [...nodeTypesByName.keys()];
