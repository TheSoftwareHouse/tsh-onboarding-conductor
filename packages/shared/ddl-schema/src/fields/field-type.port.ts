import type { NormalizedWorkflowCondition, WorkflowConditionScalar } from '../workflow-condition';
import type { WorkflowInvalidReason } from '../workflow-invalid.error';

export type JsonSchemaFragment = Record<string, unknown>;

/** Where a field descriptor may appear: step data, an object's `fields`, or an array's `items`. */
export type WorkflowFieldLevel = 'root' | 'nested' | 'arrayItem';

export type FailWorkflow = (reason: WorkflowInvalidReason) => never;

/**
 * The open envelope every normalized field shares. Type-specific members (`validation`, `fields`,
 * `items`, …) live in the field module that produced them.
 */
export type AnyNormalizedField = {
  type: string;
  required?: boolean;
  persist?: boolean;
  when?: NormalizedWorkflowCondition;
};

export type FieldNormalizationContext = {
  readonly level: WorkflowFieldLevel;
  readonly field: Record<string, unknown>;
  readonly validation: Record<string, unknown> | undefined;
  readonly required: boolean | undefined;
  readonly persist: boolean | undefined;
  readonly includeRequired: boolean;
  readonly includePersist: boolean;
  normalizeChild(child: unknown, level: WorkflowFieldLevel): AnyNormalizedField;
};

export type BuildChildDataSchema = (child: AnyNormalizedField) => JsonSchemaFragment;

/**
 * Everything the package knows about one field type. Adding a type means adding one module that
 * implements this port plus one entry in `field-type.registry.ts`.
 */
export interface WorkflowFieldTypeDefinition<TType extends string = string> {
  /** Canonical type name, also the discriminator written into normalized fields. */
  readonly type: TType;
  /** Accepted legacy spellings, normalized to `type` (for example `string` → `text`). */
  readonly aliases: readonly string[];
  readonly levels: readonly WorkflowFieldLevel[];
  /** Declarative per-step occurrence limit, replacing hard-coded step rules. */
  readonly maxOccurrencesPerStep?: number;
  /** Whether step data must always carry this field, regardless of its `required` flag. */
  readonly alwaysRequiredInStepData?: boolean;
  /** The shared `<type>Validation` definition, or `undefined` when the type inlines it. */
  buildValidationSchema(): JsonSchemaFragment | undefined;
  buildDescriptorSchema(level: WorkflowFieldLevel): JsonSchemaFragment;
  validateValidation(validation: Record<string, unknown>, fail: FailWorkflow): void;
  normalizeField(context: FieldNormalizationContext, fail: FailWorkflow): AnyNormalizedField;
  buildDataSchema(
    field: AnyNormalizedField,
    buildChildSchema: BuildChildDataSchema,
  ): JsonSchemaFragment;
  /** Omitted by types that cannot be compared in a condition, such as `file`, `object` and `array`. */
  validateConditionLiteral?(
    value: WorkflowConditionScalar,
    field: AnyNormalizedField,
    fail: FailWorkflow,
  ): void;
}
