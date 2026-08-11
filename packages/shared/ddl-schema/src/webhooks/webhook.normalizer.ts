import { isPlainObject } from '../value-guards';
import type {
  NormalizedWorkflowNotifyWebhookDeclaration,
  NormalizedWorkflowRootWebhookDeclaration,
  NormalizedWorkflowTransitionWebhookDeclaration,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

const normalizeNotifyWebhook = (webhook: unknown): NormalizedWorkflowNotifyWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    failWorkflow('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;

  if (typeof webhookRecord.path !== 'string') {
    failWorkflow('INVALID_VALUE');
  }

  const path = webhookRecord.path as string;
  if (path.length === 0 || path.trim() !== path) {
    failWorkflow('INVALID_VALUE');
  }

  const segments = path.split('/');
  if (segments.length === 0) {
    failWorkflow('INVALID_VALUE');
  }

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      failWorkflow('INVALID_VALUE');
    }

    if (!PATH_SEGMENT_PATTERN.test(segment)) {
      failWorkflow('INVALID_VALUE');
    }
  }

  return { path };
};

export const normalizeRootWebhook = (
  webhook: unknown,
): NormalizedWorkflowRootWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    failWorkflow('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(webhookRecord, 'notify')) {
    failWorkflow('INVALID_VALUE');
  }

  return { notify: normalizeNotifyWebhook(webhookRecord.notify) };
};

/** A transition webhook may only opt out of notification; it carries no destination of its own. */
export const normalizeTransitionWebhook = (
  webhook: unknown,
): NormalizedWorkflowTransitionWebhookDeclaration => {
  if (!isPlainObject(webhook)) {
    failWorkflow('INVALID_VALUE');
  }

  const webhookRecord = webhook as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(webhookRecord, 'notify')) {
    failWorkflow('INVALID_VALUE');
  }

  if (webhookRecord.notify !== false) {
    failWorkflow('INVALID_VALUE');
  }

  return { notify: false };
};
