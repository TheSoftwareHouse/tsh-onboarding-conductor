import { describe, expect, it } from 'vitest';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import { buildSourceKey, renameSourceKeys } from './source-key';

describe('buildSourceKey', () => {
  it('lowercases the id and replaces separators with underscores', () => {
    expect(buildSourceKey('EU-B2C.kyc')).toBe('eu_b2c_kyc');
  });
});

describe('renameSourceKeys', () => {
  it('renames a source key from the workflow id, keeping shared keys shared', () => {
    const document = {
      id: 'kyc',
      version: 1,
      steps: [
        { config: { sourceKey: 'kyc_v1' } },
        { config: { sourceKey: 'kyc_v1' } },
        { config: { connectors: [{ config: { sourceKey: 'other' } }] } },
      ],
    } as unknown as WorkflowDocumentInput;

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [
        { config: { sourceKey: 'my_kyc' } },
        { config: { sourceKey: 'my_kyc' } },
        { config: { connectors: [{ config: { sourceKey: 'my_kyc_2' } }] } },
      ],
    });
  });

  it('leaves unrelated keys alone', () => {
    const document = {
      id: 'kyc',
      version: 1,
      steps: [{ config: { label: 'kyc_v1', nested: { sourceKeys: 'x' } } }],
    } as unknown as WorkflowDocumentInput;

    expect(renameSourceKeys(document, 'my-kyc')).toEqual(document);
  });
});
