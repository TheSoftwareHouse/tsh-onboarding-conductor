import type { WorkflowStatus } from '../scenarios/scenario-plan';

/** What the seeder leaves behind: which onboarding demonstrates which scenario, and the answer. */
export interface SeedManifest {
  generatedAt: string;
  seed: number;
  workflow: { id: string; version: number };
  /** Present only when `--spread-days` moved the onboardings back in time. */
  spreadDays?: number;
  scenarios: SeedManifestScenario[];
}

export interface SeedManifestScenario {
  /** `<family>-<nn>`, for example `score-reject-03`. */
  key: string;
  onboardingId: string;
  expectedStatus: WorkflowStatus;
  expectedStep: string | null;
  parked: boolean;
  /** The answer an analyst skill must reach. */
  explanation: string;
}
