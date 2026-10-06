import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';

export const CSV_BOM = '﻿';

const CSV_LINE_END = '\r\n';
const SCORE_PREFIX = 'score:';
const DATA_PREFIX = 'data:';
const OTHER_DATA_COLUMN = `${DATA_PREFIX}_other`;
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];
const FIXED_COLUMNS = [
  'onboardingId',
  'workflowId',
  'workflowVersion',
  'status',
  'currentStep',
  'agreementStatus',
  'rejectionReason',
  'createdAt',
  'updatedAt',
  'completedAt',
] as const;

export interface OnboardingsCsvColumns {
  scoreNames: readonly string[];
  dataFields: readonly string[];
}

export interface OnboardingsCsvRecord {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string;
  agreementStatus: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  scores: Readonly<Record<string, unknown>>;
  context: Readonly<Record<string, unknown>>;
}

const compareDefinitions = (
  left: NormalizedWorkflowDefinition,
  right: NormalizedWorkflowDefinition,
): number => {
  if (left.id !== right.id) {
    return left.id < right.id ? -1 : 1;
  }
  return left.version - right.version;
};

export const buildOnboardingsCsvColumns = (
  definitions: readonly NormalizedWorkflowDefinition[],
): OnboardingsCsvColumns => {
  const scoreNames = new Set<string>();
  const dataFields = new Set<string>();

  for (const definition of [...definitions].sort(compareDefinitions)) {
    for (const name of Object.keys(definition.scores)) {
      scoreNames.add(name);
    }
    for (const step of definition.steps) {
      for (const [field, declaration] of Object.entries(step.data)) {
        if (declaration.persist !== false) {
          dataFields.add(field);
        }
      }
    }
  }

  return { scoreNames: [...scoreNames].sort(), dataFields: [...dataFields] };
};

const encodeCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  if (typeof value === 'string' && FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))) {
    text = `'${text}`;
  }

  return /["\r\n,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsvLine = (cells: readonly unknown[]): string =>
  cells.map(encodeCell).join(',') + CSV_LINE_END;

export const toOnboardingsCsvHeader = (columns: OnboardingsCsvColumns): string =>
  toCsvLine([
    ...FIXED_COLUMNS,
    ...columns.scoreNames.map((name) => `${SCORE_PREFIX}${name}`),
    ...columns.dataFields.map((field) => `${DATA_PREFIX}${field}`),
    OTHER_DATA_COLUMN,
  ]);

export const toOnboardingsCsvRow = (
  row: OnboardingsCsvRecord,
  columns: OnboardingsCsvColumns,
): string => {
  const declared = new Set(columns.dataFields);
  const uncovered = Object.fromEntries(
    Object.entries(row.context).filter(([key]) => !declared.has(key)),
  );

  return toCsvLine([
    ...FIXED_COLUMNS.map((column) => row[column]),
    ...columns.scoreNames.map((name) => row.scores[name]),
    ...columns.dataFields.map((field) => row.context[field]),
    Object.keys(uncovered).length > 0 ? uncovered : null,
  ]);
};
