import { describe, expect, it } from 'vitest';
import { formatAuditMetadataValue } from './audit-metadata';
import { NOT_SET } from './format-date-time';

describe('formatAuditMetadataValue', () => {
  it('renders a primitive as its own text', () => {
    expect(formatAuditMetadataValue('sumsub_kyc')).toBe('sumsub_kyc');
    expect(formatAuditMetadataValue(3)).toBe('3');
    expect(formatAuditMetadataValue(false)).toBe('false');
  });

  it('reports an absent value as not set rather than as "null"', () => {
    expect(formatAuditMetadataValue(null)).toBe(NOT_SET);
    expect(formatAuditMetadataValue(undefined)).toBe(NOT_SET);
  });

  it('joins a list, since the ones the engine records read as lists', () => {
    expect(formatAuditMetadataValue(['admin', 'operator'])).toBe('admin, operator');
  });

  it('reports an empty list as not set rather than as blank', () => {
    expect(formatAuditMetadataValue([])).toBe(NOT_SET);
  });

  it('keeps a nested object in its JSON form rather than flattening it', () => {
    expect(formatAuditMetadataValue({ kycOutcome: 'verified' })).toBe('{"kycOutcome":"verified"}');
  });
});
