import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { matchesGlob } from './glob';
import type { ChangeStatus, Check } from './golden-set';
import { type CompilationReport, diffSignatures, graphSignature } from './graph';
import type { ChangedFile } from './runner';

/** What a check reads: the sandbox after the run, git's view of it, and what the agent said. */
export type CheckContext = {
  readonly sandbox: string;
  readonly changedFiles: readonly ChangedFile[];
  readonly skillsUsed: readonly string[];
  readonly resultText: string;
  /** The skill's `evals/` directory, which `golden` paths are relative to. */
  readonly evalsDirectory: string;
  readonly ddl: () => Ddl;
};

export type CheckResult = {
  readonly check: Check;
  readonly passed: boolean;
  readonly detail: string;
};

/** The DDL package's surface the checks use; loaded lazily because the build it needs is slow. */
export type Ddl = {
  compileWorkflowReport(input: unknown): CompilationReport;
  validateAndNormalizeWorkflow(input: unknown): unknown;
  readonly WorkflowInvalidError: new (...args: never[]) => Error & {
    readonly reason?: string;
    readonly path?: string;
  };
};

export function loadDdl(): Ddl {
  // Resolved through the workspace dependency to the package's built `dist`, which
  // `ensureOracleBuild` produces before any case runs; the specs map it to the source instead.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@tsh/ddl-schema') as Ddl;
}

/** Git's two-letter status folded into the three states a case can name. */
export function changeStatusOf(file: ChangedFile): Exclude<ChangeStatus, 'any'> {
  if (file.status.includes('?') || file.status.includes('A')) {
    return 'added';
  }

  if (file.status.includes('D')) {
    return 'deleted';
  }

  return 'modified';
}

function selectFiles(
  context: CheckContext,
  glob: string,
  status: ChangeStatus = 'any',
): readonly ChangedFile[] {
  return context.changedFiles.filter(
    (file) => matchesGlob(file.path, glob) && (status === 'any' || changeStatusOf(file) === status),
  );
}

function listPaths(files: readonly ChangedFile[]): string {
  return files.length === 0 ? 'none' : files.map((file) => file.path).join(', ');
}

type Parsed = { readonly document: unknown } | { readonly problem: string };

function readJsonDocument(context: CheckContext, path: string): Parsed {
  try {
    return { document: JSON.parse(readFileSync(join(context.sandbox, path), 'utf8')) };
  } catch (error) {
    return { problem: `${path}: unreadable or not JSON — ${(error as Error).message}` };
  }
}

function describeInvalid(ddl: Ddl, error: unknown): string {
  if (error instanceof ddl.WorkflowInvalidError) {
    return `WORKFLOW_INVALID ${error.reason ?? ''}${error.path === undefined ? '' : ` at ${error.path}`}`.trim();
  }

  return (error as Error).message;
}

/** Compiles and validates the way the engine does at load; `undefined` means it passed. */
function compileProblem(ddl: Ddl, document: unknown): string | undefined {
  try {
    ddl.compileWorkflowReport(document);
    ddl.validateAndNormalizeWorkflow(document);
    return undefined;
  } catch (error) {
    return describeInvalid(ddl, error);
  }
}

/** The changed, still-present files a workflow check looks at, or the reason there are none. */
function workflowCandidates(
  context: CheckContext,
  glob: string,
): { readonly files: readonly ChangedFile[] } | { readonly problem: string } {
  const files = context.changedFiles.filter(
    (file) => matchesGlob(file.path, glob) && changeStatusOf(file) !== 'deleted',
  );

  return files.length === 0 ? { problem: `no changed file matches ${glob}` } : { files };
}

export function runCheck(check: Check, context: CheckContext): CheckResult {
  switch (check.type) {
    case 'skill-fired': {
      const fired = context.skillsUsed.includes(check.skill);

      return {
        check,
        passed: fired === check.expected,
        detail: `${check.skill} ${fired ? 'fired' : 'did not fire'}${
          context.skillsUsed.length === 0 ? '' : ` (skills used: ${context.skillsUsed.join(', ')})`
        }`,
      };
    }

    case 'files-changed': {
      const files = selectFiles(context, check.glob, check.status);
      const withinMax = check.max === undefined || files.length <= check.max;
      const range = check.max === undefined ? `at least ${check.min}` : `${check.min}-${check.max}`;

      return {
        check,
        passed: files.length >= check.min && withinMax,
        detail: `${files.length} ${check.status === 'any' ? 'changed' : check.status} file(s) match ${check.glob}, expected ${range}: ${listPaths(files)}`,
      };
    }

    case 'workflow-compiles': {
      const candidates = workflowCandidates(context, check.glob);

      if ('problem' in candidates) {
        return { check, passed: false, detail: candidates.problem };
      }

      const ddl = context.ddl();
      const problems = candidates.files.flatMap((file) => {
        const parsed = readJsonDocument(context, file.path);

        if ('problem' in parsed) {
          return [parsed.problem];
        }

        const problem = compileProblem(ddl, parsed.document);

        return problem === undefined ? [] : [`${file.path}: ${problem}`];
      });

      return {
        check,
        passed: problems.length === 0,
        detail:
          problems.length === 0
            ? `${listPaths(candidates.files)} compile and validate`
            : problems.join('; '),
      };
    }

    case 'workflow-revision': {
      const candidates = workflowCandidates(context, check.glob);

      if ('problem' in candidates) {
        return { check, passed: false, detail: candidates.problem };
      }

      const revisions = candidates.files.map((file) => {
        const parsed = readJsonDocument(context, file.path);

        if ('problem' in parsed) {
          return { path: file.path, description: parsed.problem, matches: false };
        }

        const document = parsed.document as { id?: unknown; version?: unknown };

        return {
          path: file.path,
          description: `${file.path} is ${String(document.id)}@${String(document.version)}`,
          matches: document.id === check.id && document.version === check.version,
        };
      });

      return {
        check,
        passed: revisions.every((revision) => revision.matches),
        detail: `expected ${check.id}@${check.version}: ${revisions.map((revision) => revision.description).join('; ')}`,
      };
    }

    case 'compiled-graph-matches': {
      const candidates = workflowCandidates(context, check.glob);

      if ('problem' in candidates) {
        return { check, passed: false, detail: candidates.problem };
      }

      const ddl = context.ddl();
      let golden: string[];

      try {
        golden = graphSignature(
          ddl.compileWorkflowReport(
            JSON.parse(readFileSync(join(context.evalsDirectory, check.golden), 'utf8')),
          ),
        );
      } catch (error) {
        return {
          check,
          passed: false,
          detail: `golden ${check.golden} does not compile: ${describeInvalid(ddl, error)}`,
        };
      }

      const outcomes = candidates.files.map((file) => {
        const parsed = readJsonDocument(context, file.path);

        if ('problem' in parsed) {
          return { passed: false, description: parsed.problem };
        }

        try {
          const diff = diffSignatures(
            golden,
            graphSignature(ddl.compileWorkflowReport(parsed.document)),
          );
          const passed = diff.missing.length === 0 && diff.extra.length === 0;

          return {
            passed,
            description: passed
              ? `${file.path} has the golden graph`
              : `${file.path} differs — missing: [${diff.missing.join('; ')}] extra: [${diff.extra.join('; ')}]`,
          };
        } catch (error) {
          return { passed: false, description: `${file.path}: ${describeInvalid(ddl, error)}` };
        }
      });

      return {
        check,
        passed: outcomes.every((outcome) => outcome.passed),
        detail: outcomes.map((outcome) => outcome.description).join('; '),
      };
    }

    case 'answer-matches': {
      const matched = new RegExp(check.pattern, check.flags).test(context.resultText);

      return {
        check,
        passed: matched === check.expected,
        detail: `/${check.pattern}/${check.flags} ${matched ? 'matched' : 'did not match'} the final answer${
          check.expected ? '' : ' (expected not to)'
        }`,
      };
    }
  }
}

export function runChecks(checks: readonly Check[], context: CheckContext): CheckResult[] {
  return checks.map((check) => runCheck(check, context));
}
