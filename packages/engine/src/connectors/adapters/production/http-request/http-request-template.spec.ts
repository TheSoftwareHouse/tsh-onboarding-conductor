import { WorkflowSourceKind } from '../../../../config/workflow-sources';
import {
  collectTemplateReferences,
  resolveTemplateValue,
  type TemplateScope,
} from './http-request-template';

const scope: TemplateScope = {
  payload: {
    email: 'user@example.com',
    age: 42,
    consent: true,
    absent: null,
    address: { city: 'Warsaw' },
  },
  secrets: { kycProvider: { baseUrl: 'https://api.example.com', token: 'secret-token' } },
  execution: {
    onboardingId: 'onboarding-1',
    stepName: 'collect_email',
    workflowSource: WorkflowSourceKind.USER,
  },
};

describe('resolveTemplateValue', () => {
  it('preserves the original JSON type for a whole-string placeholder', () => {
    expect(resolveTemplateValue('{{payload.age}}', scope)).toBe(42);
    expect(resolveTemplateValue('{{payload.consent}}', scope)).toBe(true);
    expect(resolveTemplateValue('{{payload.absent}}', scope)).toBeNull();
    expect(resolveTemplateValue('{{payload.address}}', scope)).toEqual({ city: 'Warsaw' });
  });

  it('interpolates an embedded placeholder into the surrounding text', () => {
    expect(resolveTemplateValue('Bearer {{secrets.kycProvider.token}}', scope)).toBe(
      'Bearer secret-token',
    );
    expect(resolveTemplateValue('{{secrets.kycProvider.baseUrl}}/v1/customers', scope)).toBe(
      'https://api.example.com/v1/customers',
    );
  });

  it('interpolates several placeholders in one string', () => {
    expect(resolveTemplateValue('{{execution.stepName}}:{{execution.onboardingId}}', scope)).toBe(
      'collect_email:onboarding-1',
    );
  });

  it('tolerates surrounding whitespace inside the placeholder', () => {
    expect(resolveTemplateValue('{{ payload.email }}', scope)).toBe('user@example.com');
  });

  it('resolves nested objects and arrays recursively', () => {
    const resolved = resolveTemplateValue(
      {
        customer: { email: '{{payload.email}}', age: '{{payload.age}}' },
        tags: ['static', '{{execution.stepName}}'],
        untouched: 7,
      },
      scope,
    );

    expect(resolved).toEqual({
      customer: { email: 'user@example.com', age: 42 },
      tags: ['static', 'collect_email'],
      untouched: 7,
    });
  });

  it('passes through strings with no placeholder', () => {
    expect(resolveTemplateValue('plain text', scope)).toBe('plain text');
  });

  it('fails when an embedded placeholder resolves to a non-scalar', () => {
    expect(() => resolveTemplateValue('city: {{payload.address}}', scope)).toThrow(
      'must resolve to a scalar when embedded in text',
    );
    expect(() => resolveTemplateValue('value: {{payload.absent}}', scope)).toThrow(
      'must resolve to a scalar when embedded in text',
    );
  });

  it('fails when the payload key is not available', () => {
    expect(() => resolveTemplateValue('{{payload.missing}}', scope)).toThrow(
      'Payload field "missing" is not available',
    );
  });

  it('fails when the secret is not configured', () => {
    expect(() => resolveTemplateValue('{{secrets.kycProvider.missing}}', scope)).toThrow(
      'Secret "kycProvider.missing" is not configured',
    );
    expect(() => resolveTemplateValue('{{secrets.missingAlias.token}}', scope)).toThrow(
      'Secret "missingAlias.token" is not configured',
    );
  });

  it('rejects an unknown placeholder namespace', () => {
    expect(() => resolveTemplateValue('{{context.email}}', scope)).toThrow(
      'Unknown placeholder namespace "context"',
    );
    expect(() => resolveTemplateValue('{{env.SECRET_TOKEN}}', scope)).toThrow(
      'Unknown placeholder namespace "env"',
    );
  });

  it('rejects malformed placeholders', () => {
    expect(() => resolveTemplateValue('{{payload}}', scope)).toThrow('Malformed placeholder');
    expect(() => resolveTemplateValue('{{ }}', scope)).toThrow('Malformed placeholder');
    expect(() => resolveTemplateValue('{{payload.email', scope)).toThrow(
      'Unbalanced placeholder braces',
    );
  });

  it('rejects placeholders with the wrong path depth', () => {
    expect(() => resolveTemplateValue('{{payload.address.city}}', scope)).toThrow(
      'must reference exactly one payload key',
    );
    expect(() => resolveTemplateValue('{{secrets.kycProvider}}', scope)).toThrow(
      'must reference a secret as secrets.alias.key',
    );
    expect(() => resolveTemplateValue('{{execution.tenantId}}', scope)).toThrow(
      'execution.onboardingId, execution.stepName',
    );
  });
});

describe('collectTemplateReferences', () => {
  it('collects references from nested structures', () => {
    const references = collectTemplateReferences({
      url: '{{secrets.kycProvider.baseUrl}}/v1',
      body: { email: '{{payload.email}}', tags: ['{{execution.stepName}}'] },
      literal: 5,
    });

    expect(references.map((reference) => reference.expression)).toEqual([
      'secrets.kycProvider.baseUrl',
      'payload.email',
      'execution.stepName',
    ]);
    expect(references[0]).toEqual({
      root: 'secrets',
      path: ['kycProvider', 'baseUrl'],
      expression: 'secrets.kycProvider.baseUrl',
    });
  });

  it('returns nothing for values without placeholders', () => {
    expect(collectTemplateReferences({ a: 'plain', b: 1, c: null })).toEqual([]);
  });
});
