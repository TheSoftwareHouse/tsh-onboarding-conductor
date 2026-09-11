import type { ErrorObject } from 'ajv';
import { failWorkflow, toWorkflowInvalidPath } from '../workflow-invalid.error';

/**
 * Maps the first Ajv error onto the invalid reason clients see. Shared by the workflow schema and
 * the compiled schema, so the same mistake — an unknown property, a missing member, an empty condition
 * branch — reads the same whichever of the two caught it. A `minItems` violation is a shape error
 * inside a condition, where an empty `all` or `any` means nothing, and a value error anywhere else.
 */
export const failSchemaValidation = (firstError: ErrorObject | undefined): never => {
  const path = toWorkflowInvalidPath(firstError?.instancePath ?? '');

  if (firstError?.keyword === 'additionalProperties') {
    failWorkflow('UNKNOWN_PROPERTY', path);
  }

  if (firstError?.keyword === 'required' || firstError?.keyword === 'type') {
    failWorkflow('INVALID_SHAPE', path);
  }

  if (firstError?.keyword === 'minItems') {
    const instancePath = firstError.instancePath ?? '';
    const schemaPath = firstError.schemaPath ?? '';
    const isConditionBranch =
      instancePath.includes('/all') ||
      instancePath.includes('/any') ||
      instancePath.includes('/in') ||
      schemaPath.includes('/definitions/conditionAll') ||
      schemaPath.includes('/definitions/conditionAny') ||
      schemaPath.includes('/definitions/conditionFieldComparison') ||
      schemaPath.includes('/definitions/transitionConditionAll') ||
      schemaPath.includes('/definitions/transitionConditionAny');

    if (isConditionBranch) {
      failWorkflow('INVALID_SHAPE', path);
    }
  }

  return failWorkflow('INVALID_VALUE', path);
};
