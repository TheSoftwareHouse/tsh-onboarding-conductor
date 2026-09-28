import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  load(scopes: readonly WorkflowScope[] = WORKFLOW_SCOPES): WorkflowFile[] {
    const files: WorkflowFile[] = [];
    // The first file declaring an id fixes its family's scope. Scopes are walked built-in first,
    // so the owner a conflict names is always the more shipped of the two.
    const familyOwners = new Map<string, WorkflowFile>();
    const seenRevisions = new Set<string>();

    for (const scope of scopes) {
      const scopeDir = this.getScopeDir(scope);

      for (const fileName of this.findJsonFileNames(scopeDir)) {
        const filePath = join(scopeDir, fileName);
        const file = this.readFile(scope, filePath);
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

  private readFile(scope: WorkflowScope, filePath: string): WorkflowFile {
    let definition: unknown;

    try {
      definition = JSON.parse(readFileSync(filePath, 'utf8'));
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

  private findJsonFileNames(scopeDir: string): string[] {
    let entryNames: string[];

    try {
      entryNames = readdirSync(scopeDir, { encoding: 'utf8' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw new WorkflowsDirectoryReadError(scopeDir, error instanceof Error ? error : undefined);
    }

    return entryNames
      .filter((entryName) => entryName.endsWith('.json'))
      .filter((entryName) => statSync(join(scopeDir, entryName)).isFile())
      .sort();
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
