import { CONNECTOR_REJECTION_REASONS, CONNECTOR_TYPES, WORKFLOW_STATUSES } from '@tsh/ddl-schema';

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
    "A connector's capability class: the axis a workflow's connector declaration and a node's " +
    'connector slot are matched on.',
};

export const API_ENUMS: readonly ApiEnum[] = [
  WORKFLOW_STATUS_ENUM,
  CONNECTOR_REJECTION_REASON_ENUM,
  CONNECTOR_TYPE_ENUM,
];
