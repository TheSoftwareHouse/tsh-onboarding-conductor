import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { WorkflowsDirectoryReadError } from './errors/workflows-directory-read.error';
import { WorkflowFileLoaderService } from './workflow-file-loader.service';
import {
  BUILT_IN_WORKFLOWS_DIR,
  DEFAULT_USER_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from './workflow-roots';

const REPOSITORY_ROOT = resolve(__dirname, '..', '..', '..', '..');
const BASE_WORKFLOW_PATH = join(REPOSITORY_ROOT, 'workflows', 'fixtures', 'base.workflow.json');

const createWorkflowFixture = (overrides: Record<string, unknown> = {}) => ({
  ...(JSON.parse(readFileSync(BASE_WORKFLOW_PATH, 'utf8')) as Record<string, unknown>),
  ...overrides,
});

const writeWorkflowFixture = (
  workflowsDir: string,
  fileName: string,
  overrides: Record<string, unknown> = {},
) => {
  writeFileSync(join(workflowsDir, fileName), JSON.stringify(createWorkflowFixture(overrides)));
};

describe('WorkflowFileLoaderService', () => {
  let usersDir: string;

  const createLoader = async (
    configuredUsersDir: string | undefined,
  ): Promise<WorkflowFileLoaderService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowFileLoaderService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(configuredUsersDir) },
        },
      ],
    }).compile();

    return module.get(WorkflowFileLoaderService);
  };

  beforeEach(() => {
    usersDir = mkdtempSync(join(tmpdir(), 'workflow-files-'));
  });

  afterEach(() => {
    rmSync(usersDir, { recursive: true, force: true });
  });

  it('resolves the shipped scopes relative to the repository root', () => {
    expect(BUILT_IN_WORKFLOWS_DIR).toBe(join(REPOSITORY_ROOT, 'workflows', 'built-in'));
    expect(FIXTURE_WORKFLOWS_DIR).toBe(join(REPOSITORY_ROOT, 'workflows', 'fixtures'));
    expect(DEFAULT_USER_WORKFLOWS_DIR).toBe(join(REPOSITORY_ROOT, 'workflows', 'users'));
  });

  it('loads the committed fixture workflows and tags them with their scope', async () => {
    const loader = await createLoader(usersDir);

    const files = loader.load(['fixtures']);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.scope === 'fixtures')).toBe(true);
    expect(files.map((file) => file.workflowId)).toContain('base');
  });

  it('loads the committed built-in workflows and tags them with their scope', async () => {
    const loader = await createLoader(usersDir);

    const files = loader.load(['built-in']);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.scope === 'built-in')).toBe(true);
    expect(files.map((file) => file.workflowId)).toContain('eu-b2c-individual-kyc-eea');
  });

  it('reads the user scope from WORKFLOWS_USERS_DIR', async () => {
    writeWorkflowFixture(usersDir, 'custom.workflow.json', { id: 'custom' });
    const loader = await createLoader(usersDir);

    expect(loader.load(['users'])).toEqual([
      expect.objectContaining({
        scope: 'users',
        filePath: join(usersDir, 'custom.workflow.json'),
        workflowId: 'custom',
        version: 1,
      }),
    ]);
  });

  it('keeps the source definition untouched so it can be stored verbatim', async () => {
    writeWorkflowFixture(usersDir, 'custom.workflow.json', { id: 'custom' });
    const loader = await createLoader(usersDir);

    expect(loader.load(['users'])[0].definition).toEqual(createWorkflowFixture({ id: 'custom' }));
  });

  it('ignores non-JSON files and nested directories', async () => {
    writeWorkflowFixture(usersDir, 'custom.workflow.json', { id: 'custom' });
    writeFileSync(join(usersDir, 'ignore.txt'), 'ignored');
    const nestedDir = join(usersDir, 'nested');
    mkdirSync(nestedDir);
    writeWorkflowFixture(nestedDir, 'nested.workflow.json', { id: 'nested' });

    const loader = await createLoader(usersDir);

    expect(loader.load(['users']).map((file) => file.workflowId)).toEqual(['custom']);
  });

  it('treats a missing scope directory as contributing no workflows', async () => {
    const loader = await createLoader(join(usersDir, 'missing'));

    expect(loader.load(['users'])).toEqual([]);
  });

  it('treats an empty scope directory as contributing no workflows', async () => {
    const loader = await createLoader(usersDir);

    expect(loader.load(['users'])).toEqual([]);
  });

  it('fails eagerly for an inaccessible scope directory', async () => {
    const inaccessibleDir = join(usersDir, 'inaccessible');
    mkdirSync(inaccessibleDir);
    chmodSync(inaccessibleDir, 0o000);
    const loader = await createLoader(inaccessibleDir);

    try {
      expect(() => loader.load(['users'])).toThrow(WorkflowsDirectoryReadError);
      expect(() => loader.load(['users'])).toThrow(
        `Cannot read workflows directory: ${inaccessibleDir}`,
      );
    } finally {
      chmodSync(inaccessibleDir, 0o700);
    }
  });

  it('fails eagerly for a non-directory scope path', async () => {
    const filePath = join(usersDir, 'file-as-dir');
    writeFileSync(filePath, 'not a directory');
    const loader = await createLoader(filePath);

    expect(() => loader.load(['users'])).toThrow(WorkflowsDirectoryReadError);
  });

  it('fails eagerly on malformed JSON', async () => {
    writeFileSync(join(usersDir, 'broken.workflow.json'), '{"id":');
    const loader = await createLoader(usersDir);

    expect(() => loader.load(['users'])).toThrow(WorkflowInvalidError);
    expect(() => loader.load(['users'])).toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly on a schema-invalid definition', async () => {
    writeWorkflowFixture(usersDir, 'invalid.workflow.json', { id: 'invalid', steps: undefined });
    const loader = await createLoader(usersDir);

    expect(() => loader.load(['users'])).toThrow(WorkflowInvalidError);
  });

  it('fails eagerly on a targetless manual transition', async () => {
    writeWorkflowFixture(usersDir, 'manual.workflow.json', {
      id: 'manual-review',
      name: 'Manual Review',
      initial: 'review',
      steps: [
        {
          name: 'review',
          type: 'custom',
          config: {
            status: 'awaiting_manual_review',
            transitions: [{ status: 'manual.approve' }],
          },
        },
      ],
    });
    const loader = await createLoader(usersDir);

    expect(() => loader.load(['users'])).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_INVALID', reason: 'INVALID_SHAPE' }),
    );
  });

  it('fails eagerly when two files declare the same id and version', async () => {
    writeWorkflowFixture(usersDir, 'custom.workflow.json', { id: 'custom', version: 1 });
    writeWorkflowFixture(usersDir, 'custom.duplicate.workflow.json', { id: 'custom', version: 1 });
    const loader = await createLoader(usersDir);

    expect(() => loader.load(['users'])).toThrow(WorkflowInvalidError);
  });

  it('fails eagerly when the same id and version is declared in two scopes', async () => {
    writeWorkflowFixture(usersDir, 'base.workflow.json');
    const loader = await createLoader(usersDir);

    expect(() => loader.load(['fixtures', 'users'])).toThrow(WorkflowInvalidError);
  });

  it('accepts several versions of the same workflow id', async () => {
    writeWorkflowFixture(usersDir, 'custom.workflow.json', { id: 'custom', version: 1 });
    writeWorkflowFixture(usersDir, 'custom.v2.workflow.json', { id: 'custom', version: 2 });
    const loader = await createLoader(usersDir);

    expect(
      loader
        .load(['users'])
        .map((file) => file.version)
        .sort(),
    ).toEqual([1, 2]);
  });
});
