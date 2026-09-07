import {
  evaluateCondition,
  type NormalizedWorkflowScore,
  type NormalizedWorkflowScoringRule,
} from '@tsh/ddl-schema';

/**
 * Owns the arithmetic behind a workflow's declared scores: where they start, and how a step's
 * rules move them. Nest-free — the engine's `workflows/domain/` folder stays free of framework and
 * HTTP types so this class can be exercised without a Nest test module.
 */
export class Scoring {
  constructor(private readonly scores: Readonly<Record<string, NormalizedWorkflowScore>>) {}

  /** Every declared score at its `min`. `{}` when the workflow declares none. */
  initialize(): Record<string, number> {
    return Object.fromEntries(Object.values(this.scores).map((score) => [score.name, score.min]));
  }

  /**
   * Current scores with one step's rules applied. Sums the `add` of every rule whose `when` holds
   * (a rule with no `when` always holds) onto the running value, then clamps each score it touched
   * to `[min, max]` once, after every rule has been summed — so declaration order never changes the
   * outcome. A score absent from `current` enters at its declared `min` before the sum. Never
   * mutates `current`.
   */
  applyRules(
    current: Readonly<Record<string, number>>,
    rules: readonly NormalizedWorkflowScoringRule[],
    context: Readonly<Record<string, unknown>>,
  ): Record<string, number> {
    const next: Record<string, number> = { ...current };
    const touchedScoreNames = new Set<string>();

    for (const rule of rules) {
      if (!evaluateCondition(rule.when, context)) {
        continue;
      }

      const declaration = this.scores[rule.score];
      const base = Object.prototype.hasOwnProperty.call(next, rule.score)
        ? next[rule.score]
        : declaration.min;

      next[rule.score] = base + rule.add;
      touchedScoreNames.add(rule.score);
    }

    for (const scoreName of touchedScoreNames) {
      const declaration = this.scores[scoreName];
      next[scoreName] = Math.min(declaration.max, Math.max(declaration.min, next[scoreName]));
    }

    return next;
  }
}
