import { CONNECTOR_REJECTION_REASONS, CONNECTOR_TYPES, WORKFLOW_STATUSES } from '@tsh/ddl-schema';
import { AGREEMENT_TYPES, ONBOARDING_AGREEMENT_STATUSES } from '../agreements/agreement.types';
import { CONNECTOR_SCOPES } from '../connectors/connector-adapter-scope';
import { ENCRYPTION_KEY_ROTATION_INTERVALS } from '../encryption/encryption-key-rotation';
import { WORKFLOW_SCOPES } from '../workflows/workflow-scope';
import { WORKFLOW_STATUSES as WORKFLOW_VERSION_STATUSES } from '../workflows/workflow-status';

export type ApiEnum = Readonly<{
  enum: string[];
  enumName: string;
  description: string;
}>;

/**
 * The domain enums the API exposes as named, reusable components. Spread one into `@ApiProperty`
 * beside the property's own description; `buildOpenApiDocument` then writes the component itself
 * from the same constant, so its description is this one whichever property the document scanner
 * met first.
 */
export const WORKFLOW_STATUS_ENUM: ApiEnum = {
  enum: [...WORKFLOW_STATUSES],
  enumName: 'WorkflowStatus',
  description:
    'Where an onboarding stands. `awaiting_user` and `awaiting_manual_review` are live; ' +
    '`approved`, `rejected` and `invalid` are terminal.',
};

export const WORKFLOW_VERSION_STATUS_ENUM: ApiEnum = {
  enum: [...WORKFLOW_VERSION_STATUSES],
  enumName: 'WorkflowVersionStatus',
  description:
    "A stored revision's lifecycle: `published` is served, `draft` is only reachable pinned, " +
    '`retired` refuses to run.',
};

export const CONNECTOR_REJECTION_REASON_ENUM: ApiEnum = {
  enum: [...CONNECTOR_REJECTION_REASONS],
  enumName: 'ConnectorRejectionReason',
  description:
    "Why a connector refused the step's data: the caller exhausted its attempts, the challenge " +
    'expired or was never issued, or the provider rejected outright.',
};

export const CONNECTOR_TYPE_ENUM: ApiEnum = {
  enum: [...CONNECTOR_TYPES],
  enumName: 'ConnectorType',
  description:
    "A connector's capability class: the axis a workflow's connector declaration and a step type's " +
    'connector slot are matched on.',
};

export const CONNECTOR_SCOPE_ENUM: ApiEnum = {
  enum: [...CONNECTOR_SCOPES],
  enumName: 'ConnectorScope',
  description:
    'Which group registered the connector adapter: `built-in` ships with the engine, `fixtures` ' +
    'is a mock used for demos and tests, `users` was added by this deployment.',
};

export const AGREEMENT_TYPE_ENUM: ApiEnum = {
  enum: [...AGREEMENT_TYPES],
  enumName: 'AgreementType',
  description:
    'What an agreement family is: terms, or a privacy notice. A property of the family rather ' +
    'than of one version, so every version published under one `key` classifies the same way.',
};

export const PENDING_CONNECTOR_RECONCILE_OUTCOMES = [
  'applied',
  'still_pending',
  'superseded',
] as const;

export type PendingConnectorReconcileOutcome =
  (typeof PENDING_CONNECTOR_RECONCILE_OUTCOMES)[number];

export const PENDING_CONNECTOR_RECONCILE_OUTCOME_ENUM: ApiEnum = {
  enum: [...PENDING_CONNECTOR_RECONCILE_OUTCOMES],
  enumName: 'PendingConnectorReconcileOutcome',
  description:
    'What an operator reconcile did: `applied` moved the onboarding with the verdict the ' +
    'provider holds, `still_pending` found the provider undecided and changed nothing, ' +
    '`superseded` found the onboarding no longer parked on that attempt and changed nothing.',
};

export const ONBOARDING_AGREEMENT_STATUS_ENUM: ApiEnum = {
  enum: [...ONBOARDING_AGREEMENT_STATUSES],
  enumName: 'OnboardingAgreementStatus',
  description:
    'Where an onboarding stands on an agreement family, or on every family it holds: ' +
    '`not_accepted` while there is no accepted version, `outdated` when there is one but a newer ' +
    'version has been published, `current` otherwise. Derived, never stored.',
};

export const WORKFLOW_SCOPE_ENUM: ApiEnum = {
  enum: [...WORKFLOW_SCOPES],
  enumName: 'WorkflowScope',
  description:
    'The scope directory that created the workflow family: `built-in` ships with the engine, ' +
    '`fixtures` is demo and test data, `users` was added by this deployment.',
};

export const ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM: ApiEnum = {
  enum: [...ENCRYPTION_KEY_ROTATION_INTERVALS],
  enumName: 'EncryptionKeyRotationInterval',
  description:
    'How often the engine rotates the encryption key on its own, measured from the active ' +
    "key's creation: 48 or 96 hours, one or two weeks, or a fixed 30-day month.",
};

export const API_ENUMS: readonly ApiEnum[] = [
  WORKFLOW_STATUS_ENUM,
  WORKFLOW_VERSION_STATUS_ENUM,
  CONNECTOR_REJECTION_REASON_ENUM,
  CONNECTOR_TYPE_ENUM,
  CONNECTOR_SCOPE_ENUM,
  AGREEMENT_TYPE_ENUM,
  ONBOARDING_AGREEMENT_STATUS_ENUM,
  PENDING_CONNECTOR_RECONCILE_OUTCOME_ENUM,
  WORKFLOW_SCOPE_ENUM,
  ENCRYPTION_KEY_ROTATION_INTERVAL_ENUM,
];
