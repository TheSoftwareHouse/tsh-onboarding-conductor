import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGREEMENT_LINK_STATUSES,
  AGREEMENT_TYPES,
  ONBOARDING_AGREEMENT_STATUSES,
} from './agreement.types';

const migrationSource = readFileSync(
  join(__dirname, '..', 'database', 'migrations', '0001_initial_schema.ts'),
  'utf8',
);

describe('agreement domain constants', () => {
  it('classifies an agreement family as terms or a privacy notice, each listed once', () => {
    expect(AGREEMENT_TYPES).toEqual(['terms_and_conditions', 'privacy_notice']);
    expect(new Set(AGREEMENT_TYPES).size).toBe(AGREEMENT_TYPES.length);
  });

  it('states a link as pending or accepted, matching what the link table accepts', () => {
    expect(AGREEMENT_LINK_STATUSES).toEqual(['pending', 'accepted']);

    const statusCheck = /ck_onboarding_agreements_status CHECK \(status IN \(([^)]*)\)\)/.exec(
      migrationSource,
    );

    expect(statusCheck).not.toBeNull();

    for (const status of AGREEMENT_LINK_STATUSES) {
      expect(statusCheck?.[1]).toContain(`'${status}'`);
    }
  });

  it('derives an onboarding status the view can emit, and never "not_signed"', () => {
    expect(ONBOARDING_AGREEMENT_STATUSES).toEqual(['current', 'outdated', 'not_accepted']);

    const viewExpression = migrationSource.slice(
      migrationSource.indexOf('CREATE VIEW onboarding_agreement_statuses'),
    );

    for (const status of ONBOARDING_AGREEMENT_STATUSES) {
      expect(viewExpression).toContain(`'${status}'`);
    }
  });
});
