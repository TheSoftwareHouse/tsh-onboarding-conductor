import { describe, expect, it } from 'vitest';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import type { WorkflowDocumentInput } from '@/api/workflows/workflow-drafts';
import { buildSourceKey, renameSourceKeys } from './source-key';

describe('buildSourceKey', () => {
  it('lowercases the id and replaces separators with underscores', () => {
    expect(buildSourceKey('EU-B2C.kyc')).toBe('eu_b2c_kyc');
  });
});

function buildDocument(steps: unknown[]): WorkflowDocumentInput {
  return { id: 'kyc', version: 1, steps } as unknown as WorkflowDocumentInput;
}

describe('renameSourceKeys', () => {
  it('renames a KYC step source key', () => {
    const document = buildDocument([
      { name: 'a', type: STEP_TYPE.kycIdentityVerification, config: { sourceKey: 'kyc_v1' } },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [{ config: { sourceKey: 'my_kyc' } }],
    });
  });

  it('renames a custom step connector and its fallback', () => {
    const document = buildDocument([
      {
        name: 'a',
        type: STEP_TYPE.custom,
        config: {
          connectors: [
            { config: { sourceKey: 'primary' }, fallback: [{ config: { sourceKey: 'backup' } }] },
          ],
        },
      },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [
        {
          config: {
            connectors: [
              {
                config: { sourceKey: 'my_kyc' },
                fallback: [{ config: { sourceKey: 'my_kyc_2' } }],
              },
            ],
          },
        },
      ],
    });
  });

  it('renames a connector-call step connector', () => {
    const document = buildDocument([
      {
        name: 'a',
        type: STEP_TYPE.connectorCall,
        config: { connectors: [{ config: { sourceKey: 'primary' } }] },
      },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [{ config: { connectors: [{ config: { sourceKey: 'my_kyc' } }] } }],
    });
  });

  it('renames a notify step connector and its fallback', () => {
    const document = buildDocument([
      {
        name: 'a',
        type: STEP_TYPE.notify,
        config: {
          connector: {
            config: { sourceKey: 'primary' },
            fallback: [{ config: { sourceKey: 'backup' } }],
          },
        },
      },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [
        {
          config: {
            connector: {
              config: { sourceKey: 'my_kyc' },
              fallback: [{ config: { sourceKey: 'my_kyc_2' } }],
            },
          },
        },
      ],
    });
  });

  it('keeps shared keys shared', () => {
    const document = buildDocument([
      { name: 'a', type: STEP_TYPE.kycIdentityVerification, config: { sourceKey: 'kyc_v1' } },
      {
        name: 'b',
        type: STEP_TYPE.custom,
        config: { connectors: [{ config: { sourceKey: 'kyc_v1' } }] },
      },
      {
        name: 'c',
        type: STEP_TYPE.connectorCall,
        config: { connectors: [{ config: { sourceKey: 'other' } }] },
      },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toMatchObject({
      steps: [
        { config: { sourceKey: 'my_kyc' } },
        { config: { connectors: [{ config: { sourceKey: 'my_kyc' } }] } },
        { config: { connectors: [{ config: { sourceKey: 'my_kyc_2' } }] } },
      ],
    });
  });

  it('leaves a sourceKey member outside the connector paths alone', () => {
    const document = buildDocument([
      {
        name: 'a',
        type: STEP_TYPE.custom,
        config: {
          connectors: [
            {
              fieldMapping: { sourceKey: 'applicantSource' },
              optionalFieldMapping: { sourceKey: 'applicantSource' },
              config: { sourceKey: 'kyc_v1', nested: { sourceKey: 'x' } },
            },
          ],
        },
      },
      { name: 'b', type: STEP_TYPE.form, config: { sourceKey: 'untouched' } },
    ]);

    expect(renameSourceKeys(document, 'my-kyc')).toEqual(
      buildDocument([
        {
          name: 'a',
          type: STEP_TYPE.custom,
          config: {
            connectors: [
              {
                fieldMapping: { sourceKey: 'applicantSource' },
                optionalFieldMapping: { sourceKey: 'applicantSource' },
                config: { sourceKey: 'my_kyc', nested: { sourceKey: 'x' } },
              },
            ],
          },
        },
        { name: 'b', type: STEP_TYPE.form, config: { sourceKey: 'untouched' } },
      ]),
    );
  });
});
