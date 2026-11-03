import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { GoldenCase } from './golden-set';
import { REPO_ROOT } from './runner';

/** Where the seeder writes what it created, and the variable that points a run somewhere else. */
export const DEFAULT_MANIFEST_PATH = 'packages/onboarding-seeder/out/manifest.json';
export const MANIFEST_ENV = 'SKILL_EVALS_MANIFEST';

const SEED_HINT = 'run `pnpm stack:mcp:up` and `pnpm onboardings:seed`';

const OPENING = '{{manifest:';
const PLACEHOLDER = /\{\{manifest:([A-Za-z0-9][A-Za-z0-9_-]*)(\.explanation)?\}\}/g;

/** What a placeholder can name: a scenario's onboarding id, or its explanation. */
export type ManifestScenario = { readonly onboardingId: string; readonly explanation: string };
export type SeedManifest = ReadonlyMap<string, ManifestScenario>;

/** The scenario keys a text references, in order of appearance. */
export function referencedKeys(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

/**
 * Whether every `{{manifest:` in a text is a well-formed placeholder — a scenario key, optionally
 * followed by `.explanation`. A misspelt one would otherwise reach the model verbatim.
 */
export function hasMalformedPlaceholder(text: string): boolean {
  return text.split(OPENING).length - 1 !== [...text.matchAll(PLACEHOLDER)].length;
}

/** The manifest the run reads: `SKILL_EVALS_MANIFEST` when set, else the seeder's own output. */
export function manifestPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[MANIFEST_ENV];

  if (configured === undefined || configured.trim() === '') {
    return join(REPO_ROOT, DEFAULT_MANIFEST_PATH);
  }

  return isAbsolute(configured) ? configured : resolve(REPO_ROOT, configured);
}

/** Reads the seeder's manifest; throws an error that says what to run when it is not there. */
export function loadManifest(path: string): SeedManifest {
  if (!existsSync(path)) {
    throw new Error(
      `the seed manifest ${path} does not exist; ${SEED_HINT} first (or point ${MANIFEST_ENV} at one)`,
    );
  }

  let document: { scenarios?: unknown };

  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`the seed manifest ${path} is not JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(document?.scenarios)) {
    throw new Error(`the seed manifest ${path} has no "scenarios" list`);
  }

  const scenarios = new Map<string, ManifestScenario>();

  for (const entry of document.scenarios as Record<string, unknown>[]) {
    if (
      typeof entry?.key !== 'string' ||
      typeof entry.onboardingId !== 'string' ||
      typeof entry.explanation !== 'string'
    ) {
      throw new Error(
        `the seed manifest ${path} has a scenario without a string key, onboardingId and explanation`,
      );
    }

    scenarios.set(entry.key, { onboardingId: entry.onboardingId, explanation: entry.explanation });
  }

  return scenarios;
}

/** Replaces every placeholder it can; the keys the manifest does not have come back in `missing`. */
export function substitute(
  text: string,
  manifest: SeedManifest,
): { readonly text: string; readonly missing: readonly string[] } {
  const missing: string[] = [];
  const replaced = text.replace(PLACEHOLDER, (placeholder, key: string, field?: string) => {
    const scenario = manifest.get(key);

    if (scenario === undefined) {
      missing.push(key);
      return placeholder;
    }

    return field === undefined ? scenario.onboardingId : scenario.explanation;
  });

  return { text: replaced, missing };
}

/** The texts of a case a placeholder may appear in; the golden answer is read where it is used. */
function textsOf(testCase: GoldenCase, goldenText: string | undefined): string[] {
  return [
    testCase.prompt,
    testCase.expectedOutput,
    ...testCase.assertions.map((assertion) => assertion.text),
    ...(goldenText === undefined ? [] : [goldenText]),
  ];
}

/** Reads a case's golden answer, but only when it is text a placeholder could be in. */
export function readGoldenText(directory: string, testCase: GoldenCase): string | undefined {
  if (testCase.golden === undefined) {
    return undefined;
  }

  try {
    const text = readFileSync(join(directory, testCase.golden), 'utf8');

    return text.includes(OPENING) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a case references the manifest anywhere, so a run without placeholders needs none. */
export function referencesManifest(testCase: GoldenCase, goldenText?: string): boolean {
  return textsOf(testCase, goldenText).some((text) => referencedKeys(text).length > 0);
}

/**
 * The case with its placeholders replaced, or the keys the manifest does not have. A golden answer
 * that contains placeholders travels as `goldenContent`, already replaced.
 */
export function resolveCase(
  testCase: GoldenCase,
  manifest: SeedManifest,
  goldenText?: string,
): { readonly testCase: GoldenCase } | { readonly missing: readonly string[] } {
  const missing: string[] = [];
  const apply = (text: string): string => {
    const result = substitute(text, manifest);

    missing.push(...result.missing);

    return result.text;
  };
  const resolved: GoldenCase = {
    ...testCase,
    prompt: apply(testCase.prompt),
    expectedOutput: apply(testCase.expectedOutput),
    assertions: testCase.assertions.map((assertion) => ({
      ...assertion,
      text: apply(assertion.text),
    })),
    ...(goldenText === undefined ? {} : { goldenContent: apply(goldenText) }),
  };

  return missing.length > 0 ? { missing: [...new Set(missing)] } : { testCase: resolved };
}
