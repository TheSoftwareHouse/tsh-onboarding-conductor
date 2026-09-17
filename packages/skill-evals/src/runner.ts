import { resolve } from 'node:path';

/**
 * One changed path with git's status letter: `A` or `??` for added, `M` for modified, `D` for
 * deleted. Against a baseline commit the letters come from `git diff --name-status`, with `??` for
 * the untracked files; without one they are the two columns of `git status --porcelain`.
 */
export type ChangedFile = { readonly status: string; readonly path: string };

export type ToolUse = { readonly name: string; readonly input?: Record<string, unknown> };

export type ClaudeRunOptions = {
  readonly cwd: string;
  readonly prompt: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly permissionMode?: 'bypassPermissions' | 'acceptEdits' | 'dontAsk' | 'plan';
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly onToolUse?: (toolUse: ToolUse) => 'stop' | undefined;
  readonly systemPrompt?: string;
  readonly jsonSchema?: Record<string, unknown>;
  readonly strictMcpConfig?: boolean;
  readonly disableSkills?: boolean;
};

/** The harness's final `result` message, as far as this package reads it. */
export type ClaudeResultMessage = {
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
  readonly num_turns?: number;
  /** The final answer on success; on an errored result, the harness's account of the error. */
  readonly result?: string;
  readonly errors?: readonly string[];
};

export type ClaudeRun = {
  /** Every skill the harness discovered for the run, plugins included, by invocation name. */
  readonly availableSkills: readonly string[];
  readonly code: number | null;
  readonly costEstimated: boolean;
  readonly costUnpriced: readonly string[];
  readonly costUsd: number;
  readonly result?: ClaudeResultMessage;
  readonly resultText?: string;
  readonly structuredOutput?: unknown;
  readonly skillsUsed: readonly string[];
  readonly stderr: string;
  readonly stoppedEarly: boolean;
  /** The runner's own timer killed the run; `timeoutMs` is the cap it enforced. */
  readonly timedOut: boolean;
  readonly timeoutMs: number;
  readonly toolUses: readonly ToolUse[];
  readonly tokens: number;
};

type RunnerModule = {
  readonly REPO_ROOT: string;
  createSandbox(label: string): Promise<string>;
  removeSandbox(root: string): void;
  collectChangedFiles(sandbox: string, baseline?: string): ChangedFile[];
  runClaude(options: ClaudeRunOptions): Promise<ClaudeRun>;
  abortActiveRuns(options: { keepSandboxes: boolean }): {
    stoppedRuns: number;
    sandboxesLeft: string[];
  };
  describeRunFailure(run: ClaudeRun, options?: { expectEarlyStop?: boolean }): string | undefined;
  ensureOracleBuild(): void;
  describeEnvironment(): string;
  formatUsd(amount: number): string;
};

// The runner stays a CommonJS module under `scripts/`, shared with `skills:routing` and
// `skills:ablation`, so those keep working without this package. Requiring it runs nothing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require(
  resolve(__dirname, '..', '..', '..', 'scripts', 'skill-eval-runner.cjs'),
) as RunnerModule;

export const REPO_ROOT = runner.REPO_ROOT;

export function createSandbox(label: string): Promise<string> {
  return runner.createSandbox(label);
}

export function removeSandbox(root: string): void {
  runner.removeSandbox(root);
}

/**
 * The files the agent added, changed or deleted. With the `baseline` commit the sandbox started
 * from, the comparison is against that commit, so a change the agent committed still counts.
 */
export function collectChangedFiles(sandbox: string, baseline?: string): ChangedFile[] {
  return runner.collectChangedFiles(sandbox, baseline);
}

export function runClaude(options: ClaudeRunOptions): Promise<ClaudeRun> {
  return runner.runClaude(options);
}

/**
 * Stops every run in flight and removes their sandboxes, or keeps them when asked; returns what is
 * left on disk. For a signal handler: synchronous, and it does not wait for the children to exit.
 */
export function abortActiveRuns(options: { readonly keepSandboxes: boolean }): {
  readonly stoppedRuns: number;
  readonly sandboxesLeft: readonly string[];
} {
  return runner.abortActiveRuns(options);
}

export function describeRunFailure(run: ClaudeRun): string | undefined {
  return runner.describeRunFailure(run);
}

export function ensureOracleBuild(): void {
  runner.ensureOracleBuild();
}

export function describeEnvironment(): string {
  return runner.describeEnvironment();
}

export function formatUsd(amount: number): string {
  return runner.formatUsd(amount);
}
