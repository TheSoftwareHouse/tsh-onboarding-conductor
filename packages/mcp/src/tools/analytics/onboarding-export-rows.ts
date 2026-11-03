import { Injectable } from '@nestjs/common';
import type { paths } from '@tsh/openapi';
import { FieldClassLookup, type CompileFailure } from '../../classification/field-class-lookup';
import { EngineClient } from '../../engine/engine-client';
import { humanizeKey } from '../../masking/csv-columns';
import { FieldClass } from '../../masking/masking.constants';
import { Masker } from '../../masking/masker';
import type { CsvColumnClasses, MaskedRecord } from '../../masking/masking.types';
import { ToolLimits } from '../../limits/tool-limits';
import { getIdentityId, RequestContext } from '../../request-context/request-context';
import { readCsvRecords } from '../shared/csv-records';
import { EXPORT_ROWS_TTL_MS, MAX_CACHED_EXPORTS, MAX_EXPORT_ROWS } from './analytics.constants';

/** The filters the engine's export accepts. */
export type ExportFilters = NonNullable<
  paths['/v1/onboardings/export']['get']['parameters']['query']
>;

/** The export's own column labels, which are how every row is keyed. */
export const ExportColumn = {
  WORKFLOW_ID: humanizeKey('workflowId'),
  WORKFLOW_VERSION: humanizeKey('workflowVersion'),
  STATUS: humanizeKey('status'),
  CURRENT_STEP: humanizeKey('currentStep'),
  REJECTION_REASON: humanizeKey('rejectionReason'),
  CREATED_AT: humanizeKey('createdAt'),
} as const;

/** Every onboarding an export matched, after masking: no raw row outlives its own iteration. */
export interface ExportedRows {
  rows: readonly MaskedRecord[];
  headers: readonly string[];
  /** Columns whose every classified value passes in clear, so grouping by one reveals nothing. */
  passHeaders: ReadonlySet<string>;
  /** Versions that did not compile; their collected fields were dropped. */
  failures: readonly CompileFailure[];
  /** True when the export held more rows than `MAX_EXPORT_ROWS`. */
  truncated: boolean;
}

interface CachedExport {
  expiresAt: number;
  exported: ExportedRows;
}

/**
 * The masked rows of the engine's CSV export, streamed once per caller and filter set and kept in
 * memory for a few minutes. Each row is masked by its own workflow version's field classes before
 * it is stored or counted, so what the cache holds is exactly what may reach the model.
 */
@Injectable()
export class OnboardingExportRows {
  private readonly cache = new Map<string, CachedExport>();

  constructor(
    private readonly engine: EngineClient,
    private readonly lookup: FieldClassLookup,
    private readonly masker: Masker,
    private readonly limits: ToolLimits,
  ) {}

  async getRows(filters: ExportFilters, context: RequestContext): Promise<ExportedRows> {
    const now = Date.now();
    const key = `${getIdentityId(context.identity)}|${JSON.stringify(
      Object.entries(filters)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    )}`;

    for (const [cachedKey, { expiresAt }] of this.cache) {
      if (expiresAt <= now) {
        this.cache.delete(cachedKey);
      }
    }

    const cached = this.cache.get(key);
    if (cached) {
      return cached.exported;
    }

    this.limits.acquireCsvExport(context.identity);
    const exported = await this.readExport(filters, context).finally(() =>
      this.limits.releaseCsvExport(context.identity),
    );

    this.cache.set(key, { expiresAt: Date.now() + EXPORT_ROWS_TTL_MS, exported });
    if (this.cache.size > MAX_CACHED_EXPORTS) {
      this.cache.delete(this.cache.keys().next().value as string);
    }

    return exported;
  }

  private async readExport(filters: ExportFilters, context: RequestContext): Promise<ExportedRows> {
    const stream = await this.engine.openStream('/v1/onboardings/export', context, {
      query: filters,
    });
    const rows: MaskedRecord[] = [];
    const columnsByVersion = new Map<string, CsvColumnClasses>();
    const classesByHeader = new Map<string, Set<FieldClass>>();
    const failures = new Map<string, CompileFailure>();
    let headers: string[] = [];
    let truncated = false;

    // Classes are fetched the first time a version appears, so a row never waits on the rest of
    // the file and is never held unmasked.
    const getColumns = async (raw: Record<string, string>): Promise<CsvColumnClasses> => {
      const version = Number(raw[ExportColumn.WORKFLOW_VERSION]);
      const refs = Number.isInteger(version)
        ? [{ workflowId: raw[ExportColumn.WORKFLOW_ID], version }]
        : [];
      const versionKey = refs.length === 0 ? '' : `${refs[0].workflowId}@${refs[0].version}`;
      const known = columnsByVersion.get(versionKey);

      if (known) {
        return known;
      }

      const { columns, failures: versionFailures } = await this.lookup.getCsvColumnClasses(
        headers,
        refs,
        context,
      );
      columnsByVersion.set(versionKey, columns);
      for (const failure of versionFailures) {
        failures.set(`${failure.workflowId}@${failure.version}`, failure);
      }
      for (const [header, { class: fieldClass }] of columns) {
        if (fieldClass !== FieldClass.DROP) {
          classesByHeader.set(header, (classesByHeader.get(header) ?? new Set()).add(fieldClass));
        }
      }

      return columns;
    };

    for await (const cells of readCsvRecords(stream)) {
      if (headers.length === 0) {
        headers = cells;
      } else if (rows.length >= MAX_EXPORT_ROWS) {
        truncated = true;
        break;
      } else {
        const raw = Object.fromEntries(
          headers.map((header, index) => [header, cells[index] ?? '']),
        );
        rows.push(this.masker.maskCsvRow(raw, await getColumns(raw)));
      }
    }

    const passHeaders = new Set(
      [...classesByHeader]
        .filter(([, classes]) => classes.size === 1 && classes.has(FieldClass.PASS))
        .map(([header]) => header),
    );

    return { rows, headers, passHeaders, failures: [...failures.values()], truncated };
  }
}
