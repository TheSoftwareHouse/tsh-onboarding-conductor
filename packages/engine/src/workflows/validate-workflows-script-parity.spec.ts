import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import {
  BUILT_IN_WORKFLOWS_DIR,
  DEFAULT_USER_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from './workflow-roots';
import { WORKFLOW_SCOPES } from './workflow-scope';

const REPOSITORY_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_PATH = join(REPOSITORY_ROOT, 'scripts', 'validate-workflows.cjs');
const BASE_WORKFLOW_PATH = join(REPOSITORY_ROOT, 'workflows', 'fixtures', 'base.workflow.json');

type ValidateWorkflowsScript = {
  DEFAULT_USER_TARGET: string;
  SHIPPED_TARGETS: readonly string[];
  collectFiles: (target: string, explicit: boolean) => string[];
  defaultTargets: () => string[];
  revisionKeyOf: (workflowId: string, version: number) => string;
};

// `pnpm workflow:validate` re-implements this loader's scope discovery in plain CommonJS, because
// it has to run without the engine's build output. Requiring it here is what stops the two
// definitions of those rules from drifting apart; the module runs nothing on require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = require(SCRIPT_PATH) as ValidateWorkflowsScript;

describe('validate-workflows.cjs parity with WorkflowFileLoaderService', () => {
  const originalUsersDir = process.env.WORKFLOWS_USERS_DIR;
  const scratchDirs: string[] = [];

  const createScratchUsersDir = (workflowId: string): string => {
    const scratch = mkdtempSync(join(tmpdir(), 'validate-workflows-parity-'));
    scratchDirs.push(scratch);

    const definition = {
      ...(JSON.parse(readFileSync(BASE_WORKFLOW_PATH, 'utf8')) as Record<string, unknown>),
      id: workflowId,
    };
    writeFileSync(join(scratch, `${workflowId}.workflow.json`), JSON.stringify(definition));

    return scratch;
  };

  const createLoader = async (usersDir: string | undefined): Promise<WorkflowFileLoaderService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowFileLoaderService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(usersDir) } },
      ],
    }).compile();

    return module.get(WorkflowFileLoaderService);
  };

  afterEach(() => {
    if (originalUsersDir === undefined) {
      delete process.env.WORKFLOWS_USERS_DIR;
    } else {
      process.env.WORKFLOWS_USERS_DIR = originalUsersDir;
    }

    while (scratchDirs.length > 0) {
      rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
    }
  });

  describe('scope coverage', () => {
    it('checks one directory for every scope the engine loads', () => {
      expect(script.defaultTargets()).toHaveLength(WORKFLOW_SCOPES.length);
    });

    it("resolves the shipped scopes to the engine's own roots", () => {
      process.env.WORKFLOWS_USERS_DIR = '/somewhere/else';

      expect(script.defaultTargets().map((target) => resolve(REPOSITORY_ROOT, target))).toEqual([
        BUILT_IN_WORKFLOWS_DIR,
        FIXTURE_WORKFLOWS_DIR,
        '/somewhere/else',
      ]);
    });

    it('falls back to the same user scope the engine does', () => {
      expect(resolve(REPOSITORY_ROOT, script.DEFAULT_USER_TARGET)).toBe(DEFAULT_USER_WORKFLOWS_DIR);
    });
  });

  describe('file discovery', () => {
    it('finds exactly the files the loader reads from a shipped scope', async () => {
      const loader = await createLoader(undefined);

      expect(script.collectFiles('workflows/fixtures', true)).toEqual(
        loader.load(['fixtures']).map((file) => file.filePath),
      );
    });

    it('follows WORKFLOWS_USERS_DIR to the directory the loader is configured with', async () => {
      const scratch = createScratchUsersDir('parity-users-scope');
      process.env.WORKFLOWS_USERS_DIR = scratch;

      const loader = await createLoader(scratch);
      const usersTarget = script.defaultTargets()[WORKFLOW_SCOPES.indexOf('users')];

      expect(script.collectFiles(usersTarget, true)).toEqual(
        loader.load(['users']).map((file) => file.filePath),
      );
    });

    it('skips a directory whose name ends in .json, as the loader does', () => {
      const scratch = mkdtempSync(join(tmpdir(), 'validate-workflows-parity-'));
      scratchDirs.push(scratch);

      mkdirSync(join(scratch, 'not-a-file.json'));
      writeFileSync(join(scratch, 'definition.json'), '{}');
      writeFileSync(join(scratch, 'notes.md'), 'ignored');

      expect(script.collectFiles(scratch, true)).toEqual([join(scratch, 'definition.json')]);
    });
  });
});
