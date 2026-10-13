import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateAndNormalizeWorkflow, WorkflowInvalidError } from '@tsh/ddl-schema';
import { WorkflowScopeConflictError } from './errors/workflow-scope-conflict.error';
import { WorkflowsDirectoryReadError } from './errors/workflows-directory-read.error';
import {
  BUILT_IN_WORKFLOWS_DIR,
  DEFAULT_USER_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from './workflow-roots';
import { WORKFLOW_SCOPES, type WorkflowScope } from './workflow-scope';

export type WorkflowFile = {
  scope: WorkflowScope;
  filePath: string;
  workflowId: string;
  version: number;
  /** The document's root `name`, when it declares one: the label its family takes on publish. */
  name?: string;
  definition: Record<string, unknown>;
};

type WorkflowIdentity = { id?: unknown; version?: unknown };

@Injectable()
export class WorkflowFileLoaderService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Reads every `.json` file sitting directly in a scope directory and validates
   * it, so a malformed definition fails startup instead of reaching the database.
   * A scope directory that does not exist simply contributes no workflows. An id
   * belongs to one scope directory: a second directory declaring it, at any
   * version, fails the load — a family lives in one scope, and a shipped flow is
   * forked under an id of its own rather than revised from `users/`.
   */
  async load(scopes: readonly WorkflowScope[] = WORKFLOW_SCOPES): Promise<WorkflowFile[]> {
    const files: WorkflowFile[] = [];
    // The first file declaring an id fixes its family's scope. Scopes are walked built-in first,
    // so the owner a conflict names is always the more shipped of the two.
    const familyOwners = new Map<string, WorkflowFile>();
    const seenRevisions = new Set<string>();

    for (const scope of scopes) {
      const scopeDir = this.getScopeDir(scope);

      for (const fileName of await this.findJsonFileNames(scopeDir)) {
        const filePath = join(scopeDir, fileName);
        const file = await this.readFile(scope, filePath);
        const owner = familyOwners.get(file.workflowId);
        const revisionKey = `${file.workflowId}@${file.version}`;

        if (owner !== undefined && owner.scope !== file.scope) {
          throw new WorkflowScopeConflictError(file, {
            scope: owner.scope,
            filePath: owner.filePath,
          });
        }

        if (seenRevisions.has(revisionKey)) {
          throw new WorkflowInvalidError('INVALID_VALUE');
        }

        familyOwners.set(file.workflowId, owner ?? file);
        seenRevisions.add(revisionKey);
        files.push(file);
      }
    }

    return files;
  }

  /**
   * Whether a scope directory holds a file declaring `workflowId` at `version`, judged on those two
   * keys alone: a file that does not parse declares nothing here, and is left for the next boot to
   * refuse; a file that cannot be read fails the check. What publishing asks, without `load`'s
   * full validation of every file.
   */
  async hasRevision(
    scopes: readonly WorkflowScope[],
    workflowId: string,
    version: number,
  ): Promise<boolean> {
    const scopeFilePaths = await Promise.all(
      scopes.map(async (scope) => {
        const scopeDir = this.getScopeDir(scope);
        const fileNames = await this.findJsonFileNames(scopeDir);

        return fileNames.map((fileName) => join(scopeDir, fileName));
      }),
    );
    // Only `id` and `version` are read, and any JSON value answers a property read, so none is validated.
    const documents = await Promise.all(
      scopeFilePaths.flat().map(async (filePath) => {
        const content = await readFile(filePath, 'utf8');

        try {
          return JSON.parse(content) as WorkflowIdentity | null;
        } catch (error) {
          // Only a parse failure is skipped; an unreadable file must not pass for one that declares nothing.
          if (error instanceof SyntaxError) {
            return null;
          }

          throw error;
        }
      }),
    );

    return documents.some(
      (document) => document?.id === workflowId && document.version === version,
    );
  }

  private async readFile(scope: WorkflowScope, filePath: string): Promise<WorkflowFile> {
    let definition: unknown;

    try {
      definition = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      throw new WorkflowInvalidError('INVALID_VALUE');
    }

    const normalizedWorkflow = validateAndNormalizeWorkflow(definition);

    return {
      scope,
      filePath,
      workflowId: normalizedWorkflow.id,
      version: normalizedWorkflow.version,
      name: normalizedWorkflow.name,
      definition: definition as Record<string, unknown>,
    };
  }

  private async findJsonFileNames(scopeDir: string): Promise<string[]> {
    let entryNames: string[];

    try {
      entryNames = await readdir(scopeDir, { encoding: 'utf8' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw new WorkflowsDirectoryReadError(scopeDir, error instanceof Error ? error : undefined);
    }

    const jsonNames = entryNames.filter((entryName) => entryName.endsWith('.json'));
    // `stat` follows symlinks, so a symlinked workflow file still counts as a file.
    const isFile = await Promise.all(
      jsonNames.map(async (entryName) => (await stat(join(scopeDir, entryName))).isFile()),
    );

    return jsonNames.filter((_, index) => isFile[index]).sort();
  }

  private getScopeDir(scope: WorkflowScope): string {
    switch (scope) {
      case 'built-in':
        return BUILT_IN_WORKFLOWS_DIR;
      case 'fixtures':
        return FIXTURE_WORKFLOWS_DIR;
      case 'users':
        return this.getUserWorkflowsDir();
    }
  }

  private getUserWorkflowsDir(): string {
    const configuredDir = this.configService.get<string>('WORKFLOWS_USERS_DIR');

    if (typeof configuredDir === 'string' && configuredDir.trim().length > 0) {
      return resolve(configuredDir.trim());
    }

    return DEFAULT_USER_WORKFLOWS_DIR;
  }
}
