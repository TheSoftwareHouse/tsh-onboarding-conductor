import type { components } from '@tsh/openapi';
import type { FieldClass, PseudonymFormat } from './masking.constants';

/** How one named field is masked. `numericOnly` passes a value only when it is a number. */
export type FieldClassification =
  | { class: typeof FieldClass.PASS; numericOnly?: true }
  | { class: typeof FieldClass.PSEUDONYMISE; format: PseudonymFormat }
  | { class: typeof FieldClass.GENERALISE }
  | { class: typeof FieldClass.DROP };

/** Field name to classification; a name absent from the map is dropped. */
export type FieldClassMap = ReadonlyMap<string, FieldClassification>;

/** CSV header label to classification; a header absent from the map is dropped. */
export type CsvColumnClasses = ReadonlyMap<string, FieldClassification>;

/**
 * What the classifier reads of a field declaration in the compiled workflow document
 * (`CompiledWorkflowDocument`). `validation` stays loose because each type carries its own.
 */
export interface FieldShape {
  type: string;
  validation?: Readonly<Record<string, unknown>>;
  items?: FieldShape;
}

export interface ClassifiableWorkflowDocument {
  steps: ReadonlyArray<{ data?: Readonly<Record<string, FieldShape>> }>;
}

/** A value that may leave the MCP: JSON with no undefined. */
export type MaskedValue =
  | string
  | number
  | boolean
  | null
  | readonly MaskedValue[]
  | { readonly [key: string]: MaskedValue };

export type MaskedRecord = Readonly<Record<string, MaskedValue>>;

/** An audit row as the engine lists it, plus the before and after snapshots a row may carry. */
export type AuditEntry = components['schemas']['AuditEventResponseDto'] & {
  before?: unknown;
  after?: unknown;
};

export type MaskedAuditEntry = Omit<AuditEntry, 'metadata' | 'before' | 'after'> & {
  metadata: MaskedRecord;
  before?: MaskedRecord | null;
  after?: MaskedRecord | null;
};
