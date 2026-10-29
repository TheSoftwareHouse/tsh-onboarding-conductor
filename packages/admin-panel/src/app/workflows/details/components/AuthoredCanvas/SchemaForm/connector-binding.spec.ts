import { describe, expect, it } from 'vitest';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import type { ConnectorType } from '@tsh/ddl-schema/workflow-contract';
import { findConnectorType, retypeConnector } from './connector-binding';

const NOTIFY_TYPES: ConnectorType[] = ['email_delivery', 'sms_delivery'];

describe('findConnectorType', () => {
  it('takes the declared type first', () => {
    expect(findConnectorType({ type: 'sms_delivery' }, NOTIFY_TYPES, STEP_TYPE.notify)).toBe(
      'sms_delivery',
    );
  });

  it("falls back to the slot's default type", () => {
    expect(findConnectorType({}, NOTIFY_TYPES, STEP_TYPE.notify)).toBe('email_delivery');
  });

  it("falls back to the slot's only type", () => {
    expect(findConnectorType({}, ['kyc'], null)).toBe('kyc');
  });

  it('is undefined when the slot leaves a choice and names no default', () => {
    expect(findConnectorType({}, NOTIFY_TYPES, null)).toBeUndefined();
  });
});

describe('retypeConnector', () => {
  it('drops every id in the chain when the type changes', () => {
    const binding = {
      id: 'smtp',
      type: 'email_delivery',
      fallback: [{ id: 'mailgun', type: 'email_delivery', retry: { maxAttempts: 2 } }],
    };

    expect(retypeConnector(binding, 'sms_delivery', NOTIFY_TYPES, STEP_TYPE.notify)).toEqual({
      type: 'sms_delivery',
      fallback: [{ retry: { maxAttempts: 2 } }],
    });
  });

  it('keeps the ids when the resolved type stays the same', () => {
    expect(
      retypeConnector({ id: 'smtp' }, 'email_delivery', NOTIFY_TYPES, STEP_TYPE.notify),
    ).toEqual({ id: 'smtp', type: 'email_delivery' });
  });
});
