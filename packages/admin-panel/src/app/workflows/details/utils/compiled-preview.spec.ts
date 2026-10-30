import { describe, expect, it } from 'vitest';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import type { AuthoredStep } from './authored-document';
import { compilePreviews, mapFieldOwners, type CompiledPreview } from './compiled-preview';

const none = (): ReadonlySet<string> => new Set();

const form: AuthoredStep = {
  name: 'details',
  type: STEP_TYPE.form,
  config: { fields: { fullName: { type: 'text', required: true } } },
};

const contact: AuthoredStep = {
  name: 'contact',
  type: STEP_TYPE.contactDetails,
  config: { email: 'omitted' },
};

const otp: AuthoredStep = {
  name: 'phone',
  type: STEP_TYPE.otpVerify,
  config: { channel: 'sms', connector: { id: 'otp' } },
};

function readFields(preview: CompiledPreview | undefined): Record<string, string[]> {
  if (preview?.kind !== 'compiled') throw new Error('expected a compiled preview');
  return Object.fromEntries(preview.steps.map((step) => [step.name, Object.keys(step.data)]));
}

describe('compilePreviews', () => {
  it('lists the fields a step stores', () => {
    const previews = compilePreviews([form], none);

    expect(readFields(previews.get('details'))).toEqual({ details: ['fullName'] });
  });

  it('lists the fields of a step type that compiles to sub-steps', () => {
    const previews = compilePreviews([contact, otp], (name) =>
      name === 'phone' ? new Set(['contact']) : new Set(),
    );

    const stored = readFields(previews.get('phone'));

    expect(Object.keys(stored)).toEqual(['phone', 'phone_verify', 'phone_resend']);
    expect(stored.phone_verify).toContain('verificationCode');
  });

  it('lists the callback fields of a KYC step', () => {
    const collected: AuthoredStep[] = [
      { name: 'profile', type: STEP_TYPE.identityProfile, config: { nationalities: 'eea' } },
      { name: 'address', type: STEP_TYPE.address, config: { countries: 'eea' } },
      { name: 'purpose', type: STEP_TYPE.questionnaire, config: { sections: ['purpose'] } },
      {
        name: 'choice',
        type: STEP_TYPE.documentChoice,
        config: { documents: [{ type: 'PASSPORT', countries: 'eea' }] },
      },
      { name: 'capture', type: STEP_TYPE.documentCapture, config: { document: 'PASSPORT' } },
    ];
    const kyc: AuthoredStep = {
      name: 'identity',
      type: STEP_TYPE.kycIdentityVerification,
      config: { connector: { id: 'sumsub_kyc' }, sourceKey: 'onboarding', maxAttemptsPerDocSet: 3 },
    };

    const previews = compilePreviews([...collected, kyc], (name) =>
      name === 'identity' ? new Set(collected.map((step) => step.name)) : new Set(),
    );

    expect(readFields(previews.get('identity')).identity).toContain('kycOutcome');
  });

  it('scopes what a step reads to its ancestors', () => {
    const asAncestor = compilePreviews([contact, otp], (name) =>
      name === 'phone' ? new Set(['contact']) : new Set(),
    );
    const asStranger = compilePreviews([contact, otp], none);

    expect(asAncestor.get('phone')?.kind).toBe('compiled');
    expect(asStranger.get('phone')?.kind).toBe('failed');
  });

  it('leaves the other previews intact when one step is broken', () => {
    const broken: AuthoredStep = { name: 'broken', type: STEP_TYPE.form, config: { fields: 'no' } };

    const previews = compilePreviews([broken, form], none);

    expect(previews.get('broken')).toEqual({
      kind: 'failed',
      message: expect.stringContaining('steps[0].config'),
    });
    expect(previews.get('details')?.kind).toBe('compiled');
  });

  it('fails a step of an unknown type without throwing', () => {
    const previews = compilePreviews([{ name: 'odd', type: 'nope' }], none);

    expect(previews.get('odd')?.kind).toBe('failed');
  });

  it('compiles a step with wired ports', () => {
    const wired: AuthoredStep = { ...form, edges: { success: 'next' } };

    expect(compilePreviews([wired], none).get('details')?.kind).toBe('compiled');
  });
});

describe('mapFieldOwners', () => {
  it('names every step that creates a field', () => {
    const twin: AuthoredStep = { ...form, name: 'twin' };

    const owners = mapFieldOwners(compilePreviews([form, twin], none));

    expect(owners.get('fullName')).toEqual(['details', 'twin']);
  });

  it('skips a step that does not compile', () => {
    const broken: AuthoredStep = { name: 'broken', type: STEP_TYPE.form, config: { fields: 'no' } };

    expect(mapFieldOwners(compilePreviews([broken, form], none)).get('fullName')).toEqual([
      'details',
    ]);
  });
});
