import { runBounded } from '../concurrency/run-bounded';
import { EngineClient } from '../engine/engine-client';
import { MailhogClient } from '../mailhog/mailhog-client';
import type { SeedManifest, SeedManifestScenario } from '../manifest/seed-manifest';
import { ProviderReferenceReader } from '../provider/provider-reference-reader';
import { buildScenarioPlan } from '../scenarios/scenario-catalogue';
import type { ScenarioPlan } from '../scenarios/scenario-plan';
import { ScenarioRunner } from '../scenarios/scenario-runner';
import { TimestampSpreader } from '../spread/timestamp-spread';
import { WORKFLOW_ID } from '../workflow/analyst-investigation';

/** Onboardings driven at once; each holds one inline submit open against the engine at a time. */
export const SCENARIO_CONCURRENCY = 4;

export interface SeedOptions {
  seed: number;
  /** How many `approved` onboardings; every other family has a fixed size. */
  count: number;
  engineUrl: string;
  mailhogUrl: string;
  storageUrl: string;
  databaseUrl: string;
  /** When set, moves each onboarding back so it starts within this many days; off by default. */
  spreadDays?: number;
}

interface SeededScenario {
  plan: ScenarioPlan;
  onboardingId: string;
}

/**
 * Seeds every scenario of the catalogue in two passes: the first drives each onboarding as far as
 * it goes on its own, the second sends the provider callbacks that were held back, so a `parked`
 * onboarding is completed at a later moment of the run. With `spreadDays`, the timestamps are
 * rewritten last, once every scenario has reached its end state. Throws, naming each failed scenario,
 * rather than describe a population it did not build.
 */
export async function runSeed(options: SeedOptions): Promise<SeedManifest> {
  const providerReferences = new ProviderReferenceReader(options.databaseUrl);
  const runner = new ScenarioRunner({
    engine: new EngineClient(options.engineUrl),
    mailhog: new MailhogClient(options.mailhogUrl),
    providerReferences,
    storageUrl: options.storageUrl,
  });
  const plans = buildScenarioPlan(options.seed, options.count);

  try {
    const firstPass = await runBounded(plans, SCENARIO_CONCURRENCY, async (plan) => ({
      plan,
      onboardingId: await runner.execute(plan),
    }));
    const failures = collectFailures(plans, firstPass);
    const seeded = settledValues(firstPass);

    const deferred = seeded.filter(
      ({ plan }) => plan.journey.kind === 'identity-verdict' && plan.journey.deferred,
    );
    const secondPass = await runBounded(deferred, SCENARIO_CONCURRENCY, ({ plan, onboardingId }) =>
      runner.completeDeferred(plan, onboardingId),
    );
    failures.push(
      ...collectFailures(
        deferred.map(({ plan }) => plan),
        secondPass,
      ),
    );

    const verification = await runBounded(seeded, SCENARIO_CONCURRENCY, ({ plan, onboardingId }) =>
      runner.verify(plan, onboardingId),
    );
    failures.push(
      ...collectFailures(
        seeded.map(({ plan }) => plan),
        verification,
      ),
    );

    if (failures.length > 0) {
      throw new Error(`${failures.length} scenario(s) failed:\n${failures.join('\n')}`);
    }

    if (options.spreadDays !== undefined) {
      const spreader = new TimestampSpreader(options.databaseUrl);

      try {
        await spreader.spread(
          options.seed,
          seeded.map(({ plan, onboardingId }) => ({ key: plan.key, onboardingId })),
          options.spreadDays,
        );
      } finally {
        await spreader.close();
      }
    }

    return buildManifest(options, seeded, settledValues(verification));
  } finally {
    await providerReferences.close();
  }
}

function buildManifest(
  { seed, spreadDays }: SeedOptions,
  seeded: SeededScenario[],
  workflowVersions: number[],
): SeedManifest {
  const [version] = workflowVersions;

  if (workflowVersions.some((candidate) => candidate !== version)) {
    throw new Error(
      `The seeded onboardings span workflow versions ${workflowVersions.join(', ')}.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    seed,
    workflow: { id: WORKFLOW_ID, version },
    ...(spreadDays !== undefined && { spreadDays }),
    scenarios: seeded.map(({ plan, onboardingId }): SeedManifestScenario => ({
      key: plan.key,
      onboardingId,
      expectedStatus: plan.expected.status,
      expectedStep: plan.expected.step,
      parked: plan.expected.parked,
      explanation: plan.expected.explanation,
    })),
  };
}

function collectFailures<R>(
  plans: readonly ScenarioPlan[],
  results: Array<PromiseSettledResult<R>>,
): string[] {
  return results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          `- ${plans[index].key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        ]
      : [],
  );
}

function settledValues<R>(results: Array<PromiseSettledResult<R>>): R[] {
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}
