import {
  normalizeCondition,
  type ConditionNormalizationContext,
} from '../conditions/condition.normalizer';
import { isInteger, isPlainObject } from '../value-guards';
import type {
  NormalizedWorkflowScore,
  NormalizedWorkflowScoringRule,
  CompiledWorkflowStep,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

/**
 * Normalizes the root `scoring` block into the named scores a document declares. `{}` on a
 * document declaring none, so every consumer reads one shape.
 */
export const normalizeScoreDeclarations = (
  scoring: unknown,
): Record<string, NormalizedWorkflowScore> => {
  if (scoring === undefined) {
    return {};
  }

  if (!isPlainObject(scoring)) {
    failWorkflow('INVALID_SHAPE');
  }

  const scores: Record<string, NormalizedWorkflowScore> = {};

  for (const [name, declaration] of Object.entries(scoring as Record<string, unknown>)) {
    if (name.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }

    if (!isPlainObject(declaration)) {
      failWorkflow('INVALID_SHAPE');
    }

    const declarationRecord = declaration as Record<string, unknown>;
    const min = declarationRecord.min;
    const max = declarationRecord.max;
    if (!isInteger(min) || !isInteger(max) || (min as number) >= (max as number)) {
      failWorkflow('INVALID_VALUE');
    }

    scores[name] = { name, min: min as number, max: max as number };
  }

  return scores;
};

/**
 * Normalizes one step's `scoring` rules. A rule's `when` is an ordinary field condition — it is
 * normalized without `declaredScores` in the context, so a score leaf there is refused.
 */
export const normalizeScoringRules = (
  step: CompiledWorkflowStep,
  context: ConditionNormalizationContext,
  declaredScores: ReadonlySet<string>,
): readonly NormalizedWorkflowScoringRule[] => {
  if (step.scoring === undefined) {
    return [];
  }

  if (declaredScores.size === 0) {
    failWorkflow('INVALID_VALUE');
  }

  return step.scoring.map((rule) => {
    if (typeof rule.score !== 'string' || !declaredScores.has(rule.score)) {
      failWorkflow('INVALID_VALUE');
    }

    if (!isInteger(rule.add) || rule.add === 0) {
      failWorkflow('INVALID_VALUE');
    }

    const when = rule.when === undefined ? undefined : normalizeCondition(rule.when, context);

    return {
      score: rule.score,
      add: rule.add,
      ...(when === undefined ? {} : { when }),
    };
  });
};
