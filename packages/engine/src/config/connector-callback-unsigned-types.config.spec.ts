import { parseConnectorCallbackUnsignedTypes } from './connector-callback-unsigned-types.config';

describe('parseConnectorCallbackUnsignedTypes', () => {
  it('treats missing, empty and blank values as no opted-in connectors', () => {
    expect(parseConnectorCallbackUnsignedTypes(undefined)).toEqual([]);
    expect(parseConnectorCallbackUnsignedTypes('')).toEqual([]);
    expect(parseConnectorCallbackUnsignedTypes('   ')).toEqual([]);
  });

  it('parses a comma-separated list, trimming and de-duplicating entries', () => {
    expect(parseConnectorCallbackUnsignedTypes(' acme_kyc , legacy_bank , acme_kyc ')).toEqual([
      'acme_kyc',
      'legacy_bank',
    ]);
  });

  it('rejects entries that are not lowercase connector types', () => {
    expect(() => parseConnectorCallbackUnsignedTypes('Acme_Kyc')).toThrow(
      'CONNECTOR_CALLBACK_UNSIGNED_TYPES entries must be lowercase connector types',
    );
    expect(() => parseConnectorCallbackUnsignedTypes('acme-kyc')).toThrow(
      'CONNECTOR_CALLBACK_UNSIGNED_TYPES entries must be lowercase connector types',
    );
    expect(() => parseConnectorCallbackUnsignedTypes('acme_kyc,')).toThrow(
      'CONNECTOR_CALLBACK_UNSIGNED_TYPES entries must be lowercase connector types',
    );
  });
});
