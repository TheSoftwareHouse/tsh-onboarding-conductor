/**
 * The compile report, as far as the graph comparison reads it. Structural rather than imported
 * from `@tsh/ddl-schema` so the check can be unit-tested with hand-written reports and so a
 * renamed DDL type surfaces here as a compile error rather than a runtime one.
 */
export type ReportArm = { readonly target: string; readonly when?: unknown };
export type ReportPort = { readonly name: string; readonly arms: readonly ReportArm[] };
export type ReportStep = {
  readonly name: string;
  readonly type: string;
  readonly compiledStepNames: readonly string[];
  readonly ports: readonly ReportPort[];
};
export type CompilationReport = {
  readonly definition: {
    readonly initial: string;
    readonly steps: readonly { readonly name: string; readonly status: string }[];
  };
  readonly steps: readonly ReportStep[];
};

const TERMINAL_TYPE = 'terminal';

/**
 * A workflow's shape with every author-chosen name removed: which step types exist, which port of
 * which type leads to which type, whether an arm is conditional, which terminal outcomes exist and
 * where the flow starts. Two definitions with the same signature run the same graph; renaming a
 * step, a field or a connector label changes nothing here. Field-level detail is deliberately not
 * in it — that is what the judge's assertions are for.
 */
export function graphSignature(report: CompilationReport): string[] {
  const statusByCompiledStep = new Map(
    report.definition.steps.map((step) => [step.name, step.status] as const),
  );
  const labelByStep = new Map<string, string>();

  for (const step of report.steps) {
    const label =
      step.type === TERMINAL_TYPE
        ? `${TERMINAL_TYPE}[${statusByCompiledStep.get(step.compiledStepNames[0] ?? '') ?? '?'}]`
        : step.type;

    labelByStep.set(step.name, label);
  }

  const lines: string[] = [];
  const initialEntry = report.steps.find((step) =>
    step.compiledStepNames.includes(report.definition.initial),
  );

  lines.push(`initial: ${initialEntry === undefined ? '?' : labelByStep.get(initialEntry.name)}`);

  for (const step of report.steps) {
    const from = labelByStep.get(step.name) ?? '?';

    lines.push(`node: ${from}`);

    for (const port of step.ports) {
      for (const arm of port.arms) {
        const conditional = arm.when === undefined ? '' : '?';
        const to = labelByStep.get(arm.target) ?? '?';

        lines.push(`${from}.${port.name}${conditional} -> ${to}`);
      }
    }
  }

  return lines.sort();
}

export type SignatureDiff = {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
};

/** Multiset difference: what the golden has that the actual lacks, and the reverse. */
export function diffSignatures(
  golden: readonly string[],
  actual: readonly string[],
): SignatureDiff {
  const counts = new Map<string, number>();

  for (const line of golden) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const extra: string[] = [];

  for (const line of actual) {
    const remaining = counts.get(line) ?? 0;

    if (remaining > 0) {
      counts.set(line, remaining - 1);
    } else {
      extra.push(line);
    }
  }

  const missing = [...counts.entries()].flatMap(([line, count]) => Array(count).fill(line));

  return { missing, extra };
}
