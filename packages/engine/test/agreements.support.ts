import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { type AgreementType } from '../src/agreements/agreement.types';

/**
 * The family `workflows/fixtures/base.workflow.json` declares on its `accept_terms` step, and the
 * type it classifies as. Named once here because every suite that starts a `base` onboarding now
 * depends on it, and a copy per suite would drift from the document.
 */
export const BASE_WORKFLOW_AGREEMENT_KEY = 'base-terms';
export const BASE_WORKFLOW_AGREEMENT_TYPE: AgreementType = 'terms_and_conditions';

/**
 * Gives an agreement family a published version when it has none.
 *
 * `OnboardingsService.start` resolves every family the workflow declares and answers `503
 * AGREEMENT_NOT_PUBLISHED` when one of them has nothing published, so this is a prerequisite of
 * the first `POST /v1/onboardings` in any suite whose workflow declares agreements — not a
 * convenience.
 *
 * A family that already has a version is left as it stands. The e2e database outlives a single
 * run, and publishing again would cut the next version, put every onboarding from an earlier run
 * out of date and enqueue a webhook for each of them; skipping is what makes a second run behave
 * like the first. `scripts/run-eu-b2c-kyc-manual-test.sh` does the same thing for the same reason.
 */
export async function ensureAgreementPublished(
  app: NestExpressApplication,
  key: string,
  type: AgreementType,
): Promise<void> {
  const published = await request(app.getHttpServer())
    .get('/v1/admin/agreements')
    .query({ key, limit: 1 })
    .expect(200);

  if (published.body.meta.pagination.total > 0) {
    return;
  }

  await request(app.getHttpServer()).post('/v1/admin/agreements').send({ key, type }).expect(201);
}
