import type { WorkflowFieldDefinition } from '@/api/workflows/workflow-definitions';
import { describeCondition } from './describe-condition';

const BYTES_PER_MB = 1024 * 1024;

/** Up to this many allowed values are listed; more are counted. */
const ENUM_LISTED_MAX = 3;

function describeEnum(values: unknown, constant: unknown): string | null {
  const only = Array.isArray(values) && values.length === 1 ? values[0] : constant;
  if (typeof only === 'boolean') return `must be ${only}`;
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.length <= ENUM_LISTED_MAX ? `oneOf ${values.join(', ')}` : `oneOf ${values.length}`;
}

function describeLength(min: unknown, max: unknown): string | null {
  const hasMin = typeof min === 'number';
  const hasMax = typeof max === 'number';
  if (hasMin && hasMax) return `${min}–${max} chars`;
  if (hasMax) return `max ${max}`;
  if (hasMin) return `min ${min}`;
  return null;
}

function describeUpload(upload: NonNullable<WorkflowFieldDefinition['upload']>): string[] {
  const types = upload.contentTypes.map((type) => type.split('/').pop() ?? type).join(', ');
  const size = Number((upload.maxSizeBytes / BYTES_PER_MB).toFixed(1));
  return [types, `max ${size} MB`].filter(Boolean);
}

/** The constraints line under a field name, e.g. `text · required · 1–100 chars`. */
export function describeField(field: WorkflowFieldDefinition): string {
  const { schema, upload } = field;
  const presence = field.required ? 'required' : 'optional';
  const parts = [
    field.type,
    field.when != null ? `${presence} when ${describeCondition(field.when)}` : presence,
    typeof schema.format === 'string' ? `format ${schema.format}` : null,
    describeEnum(schema.enum, schema.const),
    describeLength(schema.minLength, schema.maxLength),
    typeof schema.pattern === 'string' ? schema.pattern : null,
    field.persist ? null : 'persist false',
    ...(upload ? describeUpload(upload) : []),
  ];
  return parts.filter((part): part is string => part !== null).join(' · ');
}
