/**
 * Domain contract for the `veriff_kyc` connector adapter's wire layer. Every value that crosses a
 * boundary — Veriff's decision payload, its session and media vocabularies, the signing headers —
 * is declared exactly once here, per `.claude/rules/constants.md`.
 */

/** `verification.status` values on a decision. The mapping decides on these, never on `code`. */
export const VERIFF_DECISION_STATUS_APPROVED = 'approved';
export const VERIFF_DECISION_STATUS_DECLINED = 'declined';
export const VERIFF_DECISION_STATUS_RESUBMISSION_REQUESTED = 'resubmission_requested';
export const VERIFF_DECISION_STATUS_EXPIRED = 'expired';
export const VERIFF_DECISION_STATUS_ABANDONED = 'abandoned';
export const VERIFF_DECISION_STATUS_REVIEW = 'review';

export const VERIFF_DECISION_STATUSES = [
  VERIFF_DECISION_STATUS_APPROVED,
  VERIFF_DECISION_STATUS_DECLINED,
  VERIFF_DECISION_STATUS_RESUBMISSION_REQUESTED,
  VERIFF_DECISION_STATUS_EXPIRED,
  VERIFF_DECISION_STATUS_ABANDONED,
  VERIFF_DECISION_STATUS_REVIEW,
] as const;

export type VeriffDecisionStatus = (typeof VERIFF_DECISION_STATUSES)[number];

/**
 * Decision `code` values. Informational only: the mapping decides on `status`, and these are
 * kept for logs. Taken from the `GET /v1/sessions/{id}/decision` reference on devdocs.veriff.com.
 */
export const VERIFF_DECISION_CODE_APPROVED = 9001;
export const VERIFF_DECISION_CODE_DECLINED = 9102;
export const VERIFF_DECISION_CODE_RESUBMISSION_REQUESTED = 9103;
export const VERIFF_DECISION_CODE_EXPIRED = 9104;
export const VERIFF_DECISION_CODE_ABANDONED = 9121;

/** The session status the adapter sets to close the upload phase and start the decision. */
export const VERIFF_SESSION_STATUS_SUBMITTED = 'submitted';

/** `image.context` values accepted by `POST /v1/sessions/{id}/media`. */
export const VERIFF_MEDIA_CONTEXT_DOCUMENT_FRONT = 'document-front';
export const VERIFF_MEDIA_CONTEXT_DOCUMENT_BACK = 'document-back';
export const VERIFF_MEDIA_CONTEXT_FACE = 'face';

export const VERIFF_MEDIA_CONTEXTS = [
  VERIFF_MEDIA_CONTEXT_DOCUMENT_FRONT,
  VERIFF_MEDIA_CONTEXT_DOCUMENT_BACK,
  VERIFF_MEDIA_CONTEXT_FACE,
] as const;

export type VeriffMediaContext = (typeof VERIFF_MEDIA_CONTEXTS)[number];

export const VERIFF_DOCUMENT_TYPES = [
  'ID_CARD',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'RESIDENCE_PERMIT',
] as const;

export type VeriffDocumentType = (typeof VERIFF_DOCUMENT_TYPES)[number];

/** Reason code Veriff reports when a session has used up its resubmissions. */
export const VERIFF_REASON_CODE_RESUBMISSION_LIMIT_EXCEEDED = 539;

/**
 * Reason codes on a `resubmission_requested` decision that point at the face capture:
 * 202 face not clearly visible, 208 selfie missing, 214 selfie poor quality.
 * 201 and 217 may belong here too — to verify against devdocs.veriff.com.
 */
export const VERIFF_FACE_RESUBMISSION_REASON_CODES = [202, 208, 214] as const;

/** Event webhook codes; logged only, never mapped to an outcome. */
export const VERIFF_EVENT_CODE_STARTED = 7001;
export const VERIFF_EVENT_CODE_SUBMITTED = 7002;

export const VERIFF_HEADER_AUTH_CLIENT = 'x-auth-client';
export const VERIFF_HEADER_HMAC_SIGNATURE = 'x-hmac-signature';
