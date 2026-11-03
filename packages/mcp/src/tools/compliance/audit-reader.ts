import { Injectable } from '@nestjs/common';
import { FieldClassLookup, WorkflowVersionRef } from '../../classification/field-class-lookup';
import { collectPages } from '../../engine/collect-pages';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { EngineError } from '../../engine/engine-error';
import { Masker } from '../../masking/masker';
import type { AuditEntry, FieldClassMap, MaskedAuditEntry } from '../../masking/masking.types';
import { RequestContext } from '../../request-context/request-context';
import { ONBOARDING_RESOURCE_TYPE } from '../shared/shared.constants';
import { AUDIT_MAX_PAGES } from './compliance.constants';

/** The engine's own audit filters; each one is an exact match, the instants inclusive. */
export interface AuditFilters {
  actorType?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  occurredFrom?: string;
  occurredTo?: string;
}

export interface AuditScanOptions {
  /** Entries to return; one more match than this marks the scan truncated. */
  maxEntries: number;
  /** A filter the engine does not offer, applied here to each row it returns. */
  matches?: (entry: AuditEntry) => boolean;
}

export interface AuditScan {
  /** Newest first, as the engine lists them. */
  entries: AuditEntry[];
  /** More matching rows may exist than were returned. */
  truncated: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the engine's audit log as the analyst and hands every row on only through the masker. */
@Injectable()
export class AuditReader {
  constructor(
    private readonly engine: EngineClient,
    private readonly masker: Masker,
    private readonly fieldClasses: FieldClassLookup,
  ) {}

  /** Pages the audit API until `maxEntries` matches are in hand or the page cap is spent. */
  async scan(
    filters: AuditFilters,
    context: RequestContext,
    { maxEntries, matches }: AuditScanOptions,
  ): Promise<AuditScan> {
    const { items, truncated } = await collectPages(
      (page) =>
        this.engine.request('get', '/v1/admin/audit', context, {
          query: { ...filters, page, limit: ENGINE_PAGE_SIZE },
        }),
      AUDIT_MAX_PAGES,
      { accept: matches, maxItems: maxEntries },
    );

    return { entries: items, truncated };
  }

  /**
   * Masks each entry by its action's allowlist. An onboarding's field classes are fetched only for
   * a row that carries submitted data, once per onboarding; when they cannot be resolved the
   * submitted data drops.
   */
  async maskEntries(
    entries: readonly AuditEntry[],
    context: RequestContext,
  ): Promise<MaskedAuditEntry[]> {
    const classesByOnboarding = new Map<string, Promise<FieldClassMap>>();
    const masked: MaskedAuditEntry[] = [];

    for (const entry of entries) {
      if (!this.carriesSubmittedData(entry)) {
        masked.push(this.masker.maskAuditEntry(entry));
        continue;
      }

      const classes =
        classesByOnboarding.get(entry.resourceId) ?? this.getOnboardingClasses(entry, context);
      classesByOnboarding.set(entry.resourceId, classes);
      masked.push(this.masker.maskAuditEntry(entry, await classes));
    }

    return masked;
  }

  private carriesSubmittedData(entry: AuditEntry): boolean {
    return (
      entry.resourceType === ONBOARDING_RESOURCE_TYPE && isRecord(entry.metadata.submittedData)
    );
  }

  private async getOnboardingClasses(
    entry: AuditEntry,
    context: RequestContext,
  ): Promise<FieldClassMap> {
    try {
      const ref =
        this.findVersionRef(entry) ?? (await this.getVersionRef(entry.resourceId, context));
      const { classes } = await this.fieldClasses.getVersionClasses(ref, context);

      return classes;
    } catch (error) {
      if (error instanceof EngineError) {
        return new Map();
      }
      throw error;
    }
  }

  /** The version a row names in its snapshots or metadata, if it does. */
  private findVersionRef(entry: AuditEntry): WorkflowVersionRef | undefined {
    for (const source of [entry.after, entry.before, entry.metadata]) {
      if (
        isRecord(source) &&
        typeof source.workflowId === 'string' &&
        typeof source.workflowVersion === 'number'
      ) {
        return { workflowId: source.workflowId, version: source.workflowVersion };
      }
    }

    return undefined;
  }

  private async getVersionRef(
    onboardingId: string,
    context: RequestContext,
  ): Promise<WorkflowVersionRef> {
    const onboarding = await this.engine.request('get', '/v1/onboardings/{id}', context, {
      path: { id: onboardingId },
    });

    return { workflowId: onboarding.workflowId, version: onboarding.workflowVersion };
  }
}
