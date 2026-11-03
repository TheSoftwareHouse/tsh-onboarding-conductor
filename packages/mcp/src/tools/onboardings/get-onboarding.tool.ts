import { Injectable } from '@nestjs/common';
import { FieldClassLookup } from '../../classification/field-class-lookup';
import { EngineClient } from '../../engine/engine-client';
import { ToolLimits } from '../../limits/tool-limits';
import { humanizeKey } from '../../masking/csv-columns';
import { Masker } from '../../masking/masker';
import {
  CSV_SCORE_HEADER_SUFFIX,
  CSV_SYSTEM_COLUMNS,
  FieldClass,
} from '../../masking/masking.constants';
import type { MaskedRecord } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { readCsvRecords } from '../shared/csv-records';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { describeCompileFailures } from './compile-warnings';
import { toOnboardingSummary } from './onboarding-summary';
import { getOnboardingId } from './onboarding-arguments';

/** Columns the summary and scores already report; the rest of a row is collected data. */
const SYSTEM_HEADERS: ReadonlySet<string> = new Set(CSV_SYSTEM_COLUMNS.map(humanizeKey));

interface CollectedData {
  /** The masked values, by the export's column labels. */
  collectedData: MaskedRecord | null;
  /** Labels of the columns whose values are never shown. */
  withheldFields: string[];
  warnings: string[];
}

/**
 * One onboarding in full: summary, scores, agreements, pending connector and masked collected
 * data. The engine exposes collected data only through its CSV export, so the tool reads the
 * export for this one onboarding; the engine audits each read as `onboardings.exported`.
 */
@McpTool()
@Injectable()
export class GetOnboardingTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'get_onboarding';
  readonly description =
    'Returns one onboarding: status, current step, scores, rejection reason, agreement ' +
    'families with accepted versus latest version, the connector it is parked on (if any) and ' +
    'its collected data in masked form. Masked form means: system values, scores, enumerated ' +
    'answers, booleans and countries are shown; email and phone appear as stable pseudonyms ' +
    '(the same value gives the same pseudonym, so duplicates can be spotted); date of birth is ' +
    'a ten-year age band; names, addresses, free text and documents are withheld and only ' +
    'listed by label in `withheldFields`. Collected data is read from the engine CSV export, ' +
    'which the engine records in its audit trail as an export under your name. To learn why ' +
    'the onboarding ended up in this state use get_onboarding_timeline.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      onboardingId: { type: 'string', description: 'The onboarding UUID, from find_onboardings.' },
    },
    required: ['onboardingId'],
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly fieldClasses: FieldClassLookup,
    private readonly masker: Masker,
    private readonly limits: ToolLimits,
  ) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const onboardingId = getOnboardingId(args);
    const row = await this.engine.request('get', '/v1/onboardings/{id}', context, {
      path: { id: onboardingId },
    });
    const summary = toOnboardingSummary(row);
    const [agreements, collected] = await Promise.all([
      this.engine.request('get', '/v1/onboardings/{id}/agreements', context, {
        path: { id: onboardingId },
      }),
      this.readCollectedData(summary, context),
    ]);

    return {
      onboarding: summary,
      agreements: agreements.items.map((agreement) => ({
        key: agreement.key,
        type: agreement.type,
        latestVersion: agreement.latestVersion,
        acceptedVersion: agreement.acceptedVersion,
        acceptedAt: agreement.acceptedAt,
        status: agreement.status,
      })),
      collectedData: collected.collectedData,
      withheldFields: collected.withheldFields,
      ...(collected.warnings.length > 0 ? { warnings: collected.warnings } : {}),
    };
  }

  private async readCollectedData(
    summary: ReturnType<typeof toOnboardingSummary>,
    context: RequestContext,
  ): Promise<CollectedData> {
    this.limits.acquireCsvExport(context.identity);

    try {
      const stream = await this.engine.openStream('/v1/onboardings/export', context, {
        query: { onboardingId: summary.onboardingId },
      });
      const records = readCsvRecords(stream);
      const { value: headers } = await records.next();
      const { value: values } = await records.next();

      if (headers === undefined || values === undefined) {
        return {
          collectedData: null,
          withheldFields: [],
          warnings: ['The engine export returned no row for this onboarding.'],
        };
      }

      const { columns, failures } = await this.fieldClasses.getCsvColumnClasses(
        headers,
        [{ workflowId: summary.workflowId, version: summary.workflowVersion }],
        context,
      );
      const row = Object.fromEntries(
        headers
          .map((header, index): [string, string] => [header, values[index] ?? ''])
          .filter(
            ([header]) => !SYSTEM_HEADERS.has(header) && !header.endsWith(CSV_SCORE_HEADER_SUFFIX),
          ),
      );

      return {
        collectedData: this.masker.maskCsvRow(row, columns),
        withheldFields: Object.keys(row).filter(
          (header) => columns.get(header)?.class === FieldClass.DROP,
        ),
        warnings: describeCompileFailures(failures),
      };
    } finally {
      this.limits.releaseCsvExport(context.identity);
    }
  }
}
