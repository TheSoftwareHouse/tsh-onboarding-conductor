import { describe, expect, it } from 'vitest';
import { findSelectedConnectorType, serializeConnectorsSearch } from './connectors-search-params';

describe('findSelectedConnectorType', () => {
  it('keeps a requested type the list contains', () => {
    expect(findSelectedConnectorType(['kyc', 'phone_verification'], 'phone_verification')).toBe(
      'phone_verification',
    );
  });

  it('falls back to the first listed type when nothing is requested', () => {
    expect(findSelectedConnectorType(['kyc', 'phone_verification'], null)).toBe('kyc');
  });

  it('falls back to the first listed type for a value the list does not contain', () => {
    expect(findSelectedConnectorType(['kyc', 'phone_verification'], 'custom')).toBe('kyc');
  });

  it('returns undefined for an empty type list', () => {
    expect(findSelectedConnectorType([], 'kyc')).toBeUndefined();
  });
});

describe('serializeConnectorsSearch', () => {
  it('carries the requested type', () => {
    expect(serializeConnectorsSearch('kyc')).toBe('?type=kyc');
  });

  it('omits the key when there is nothing to select', () => {
    expect(serializeConnectorsSearch(null)).toBe('');
  });
});
