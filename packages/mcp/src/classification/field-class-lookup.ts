import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { EngineClient } from '../engine/engine-client';
import { EngineError } from '../engine/engine-error';
import { buildCsvColumnClasses } from '../masking/csv-columns';
import { FieldClassifier, mergeFieldClassMaps } from '../masking/field-classifier';
import type { CsvColumnClasses, FieldClassMap } from '../masking/masking.types';
import { RequestContext } from '../request-context/request-context';

type WorkflowDocument = components['schemas']['WorkflowDocument'];
type WorkflowVersionStatus = components['schemas']['WorkflowVersionStatus'];

/** One stored revision of a workflow. */
export interface WorkflowVersionRef {
  workflowId: string;
  version: number;
}

/** A revision the engine would not compile, so none of its fields could be classified. */
export interface CompileFailure extends WorkflowVersionRef {
  reason: string;
}

export interface VersionFieldClasses {
  classes: FieldClassMap;
  /** Set when the version does not compile; `classes` is then empty and every field drops. */
  compileFailure?: string;
}

export interface MergedFieldClasses {
  classes: FieldClassMap;
  failures: readonly CompileFailure[];
}

export interface CsvFieldClasses {
  columns: CsvColumnClasses;
  failures: readonly CompileFailure[];
}

/** A status whose document can no longer change; a draft may be replaced at any time. */
const IMMUTABLE_STATUSES: readonly WorkflowVersionStatus[] = ['published', 'retired'];

/**
 * Field classes of a workflow version, which only the compiled form can give: the stored document
 * is the authored one and declares no fields. Immutable versions are cached; a draft is read anew
 * each time. Classes come from workflow definitions, never from applicant data, so the cache is
 * shared across callers while every fetch is made as the caller.
 */
@Injectable()
export class FieldClassLookup {
  private readonly logger = new Logger(FieldClassLookup.name);
  private readonly versions = new Map<string, Promise<VersionFieldClasses>>();

  constructor(
    private readonly engine: EngineClient,
    private readonly classifier: FieldClassifier,
  ) {}

  /** Concurrent calls for a version not yet cached share one fetch. */
  getVersionClasses(
    ref: WorkflowVersionRef,
    context: RequestContext,
  ): Promise<VersionFieldClasses> {
    const key = `${ref.workflowId}@${ref.version}`;
    const cached = this.versions.get(key);

    if (cached) {
      return cached;
    }

    const pending = this.load(ref, context).then(
      ({ result, status }) => {
        if (!IMMUTABLE_STATUSES.includes(status) || result.compileFailure !== undefined) {
          this.versions.delete(key);
        }
        return result;
      },
      (error: unknown) => {
        this.versions.delete(key);
        throw error;
      },
    );
    this.versions.set(key, pending);

    return pending;
  }

  /** The stricter class of every field any of the versions declares. */
  async getMergedClasses(
    refs: readonly WorkflowVersionRef[],
    context: RequestContext,
  ): Promise<MergedFieldClasses> {
    const resolved = await Promise.all(refs.map((ref) => this.getVersionClasses(ref, context)));
    const failures = resolved.flatMap(({ compileFailure }, index) =>
      compileFailure === undefined ? [] : [{ ...refs[index], reason: compileFailure }],
    );

    return { classes: mergeFieldClassMaps(resolved.map(({ classes }) => classes)), failures };
  }

  /** How each header of an export of these versions is masked. */
  async getCsvColumnClasses(
    headers: readonly string[],
    refs: readonly WorkflowVersionRef[],
    context: RequestContext,
  ): Promise<CsvFieldClasses> {
    const { classes, failures } = await this.getMergedClasses(refs, context);

    return { columns: buildCsvColumnClasses(headers, classes), failures };
  }

  private async load(
    ref: WorkflowVersionRef,
    context: RequestContext,
  ): Promise<{ result: VersionFieldClasses; status: WorkflowVersionStatus }> {
    const stored = await this.engine.request(
      'get',
      '/v1/admin/workflows/{workflowId}/versions/{version}/document',
      context,
      { path: ref },
    );
    const compiled = await this.engine
      .request('post', '/v1/admin/workflows/compile', context, {
        body: stored.document as unknown as WorkflowDocument,
      })
      .catch((error: unknown) => {
        if (error instanceof EngineError && error.status === HttpStatus.BAD_REQUEST) {
          return error;
        }
        throw error;
      });

    if (compiled instanceof EngineError) {
      this.logger.warn(
        `Workflow ${ref.workflowId} version ${ref.version} does not compile; its fields drop: ${compiled.message}`,
      );
      return {
        result: { classes: new Map(), compileFailure: compiled.message },
        status: stored.status,
      };
    }

    return {
      result: { classes: this.classifier.classify(compiled.definition) },
      status: stored.status,
    };
  }
}
