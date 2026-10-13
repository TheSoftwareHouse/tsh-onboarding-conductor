import { describe, expect, it } from 'vitest';
import { AUDIT_RESOURCE_TYPES, isAuditResourceType } from '@/api/audit/audit-events';
import {
  describeAuditActorTone,
  describeAuditResourceType,
  hasAuditActorIdentity,
} from './describe-audit-events';

describe('describeAuditResourceType', () => {
  it('labels every known resource type', () => {
    expect(AUDIT_RESOURCE_TYPES.map(describeAuditResourceType)).toEqual([
      'Onboardings',
      'Webhook outbox',
      'Callbacks',
      'Connector settings',
      'Admin API',
      'Workflows',
    ]);
  });

  it('falls back to the raw value for an unrecognized resource type', () => {
    expect(describeAuditResourceType('future_resource')).toBe('future_resource');
    expect(isAuditResourceType('future_resource')).toBe(false);
  });
});

describe('describeAuditActorTone', () => {
  it('tones an operator apart from system and anonymous', () => {
    expect(describeAuditActorTone('operator')).toBe('operator');
    expect(describeAuditActorTone('system')).toBe('other');
    expect(describeAuditActorTone('anonymous')).toBe('other');
  });
});

describe('hasAuditActorIdentity', () => {
  it('rejects the actor types whose id is a placeholder', () => {
    expect(hasAuditActorIdentity('system')).toBe(false);
    expect(hasAuditActorIdentity('anonymous')).toBe(false);
  });

  it('accepts an operator and any actor type it does not recognize', () => {
    expect(hasAuditActorIdentity('operator')).toBe(true);
    expect(hasAuditActorIdentity('scheduler')).toBe(true);
  });
});
