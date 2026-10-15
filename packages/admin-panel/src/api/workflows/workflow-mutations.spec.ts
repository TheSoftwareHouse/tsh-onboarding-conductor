import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { workflowMutations } from './workflow-mutations';
import { workflowQueries } from './workflow-queries';
import {
  deleteWorkflowConnectorSelection,
  putWorkflowConnectorSelection,
} from './workflow-connector-selection';
import {
  compileWorkflowDocument,
  createWorkflowDraft,
  deleteWorkflowDraft,
  publishWorkflowDraft,
  updateWorkflowDraft,
  type WorkflowDraft,
} from './workflow-drafts';

vi.mock('./workflow-connector-selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-connector-selection')>()),
  putWorkflowConnectorSelection: vi.fn(),
  deleteWorkflowConnectorSelection: vi.fn(),
}));

vi.mock('./workflow-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./workflow-drafts')>()),
  createWorkflowDraft: vi.fn(),
  updateWorkflowDraft: vi.fn(),
  deleteWorkflowDraft: vi.fn(),
  publishWorkflowDraft: vi.fn(),
  compileWorkflowDocument: vi.fn(),
}));

const DOCUMENT = { id: 'kyc' };

function draft(workflowId: string, version: number): WorkflowDraft {
  return {
    workflowId,
    version,
    status: 'draft',
    name: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

type Resolver = (data: WorkflowDraft, variables: typeof DOCUMENT) => readonly QueryKey[];

function resolve(
  targets: unknown,
  data: WorkflowDraft,
  variables: typeof DOCUMENT = DOCUMENT,
): readonly QueryKey[] {
  return (targets as Resolver)(data, variables);
}

describe('workflowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('calls createWorkflowDraft with the document', async () => {
      await workflowMutations.create().mutationFn?.(DOCUMENT, {} as never);

      expect(createWorkflowDraft).toHaveBeenCalledWith(DOCUMENT);
    });

    it('invalidates the lists, the versions and the detail of the new draft', () => {
      const { meta } = workflowMutations.create();

      expect(resolve(meta?.invalidates, draft('kyc', 2))).toEqual([
        workflowQueries.lists(),
        workflowQueries.versions('kyc').queryKey,
        workflowQueries.detail('kyc', 2).queryKey,
      ]);
      expect(meta?.awaits).toBeUndefined();
    });
  });

  describe('save', () => {
    it('calls updateWorkflowDraft with the id, the version and the document', async () => {
      await workflowMutations.save('kyc', 1).mutationFn?.(DOCUMENT, {} as never);

      expect(updateWorkflowDraft).toHaveBeenCalledWith('kyc', 1, DOCUMENT);
    });

    it('in place awaits the detail and the versions and invalidates only the lists', () => {
      const { meta } = workflowMutations.save('kyc', 1);

      expect(resolve(meta?.awaits, draft('kyc', 1))).toEqual([
        workflowQueries.detail('kyc', 1).queryKey,
        workflowQueries.versions('kyc').queryKey,
      ]);
      expect(resolve(meta?.invalidates, draft('kyc', 1))).toEqual([workflowQueries.lists()]);
    });

    it.each([
      ['a new id', draft('kyc-2', 1)],
      ['a new version', draft('kyc', 2)],
    ])('moved to %s awaits nothing and invalidates the new location', (_label, moved) => {
      const { meta } = workflowMutations.save('kyc', 1);

      expect(resolve(meta?.awaits, moved)).toEqual([]);
      expect(resolve(meta?.invalidates, moved)).toEqual([
        workflowQueries.lists(),
        workflowQueries.versions(moved.workflowId).queryKey,
        workflowQueries.detail(moved.workflowId, moved.version).queryKey,
      ]);
    });
  });

  describe('delete', () => {
    it('calls deleteWorkflowDraft with the id and the version', async () => {
      await workflowMutations.delete('kyc', 1).mutationFn?.(undefined, {} as never);

      expect(deleteWorkflowDraft).toHaveBeenCalledWith('kyc', 1);
    });

    it('invalidates the lists', () => {
      expect(workflowMutations.delete('kyc', 1).meta?.invalidates).toEqual([
        workflowQueries.lists(),
      ]);
    });
  });

  describe('publish', () => {
    it('calls publishWorkflowDraft with its bound id and version', async () => {
      await workflowMutations.publish('kyc', 3).mutationFn?.(undefined, {} as never);

      expect(publishWorkflowDraft).toHaveBeenCalledWith('kyc', 3);
    });

    it('awaits the versions and invalidates the lists and the unpinned detail', () => {
      const { meta } = workflowMutations.publish('kyc', 3);

      expect(meta?.awaits).toEqual([workflowQueries.versions('kyc').queryKey]);
      expect(meta?.invalidates).toEqual([
        workflowQueries.lists(),
        workflowQueries.detail('kyc').queryKey,
      ]);
    });

    it('does not invalidate the version document nor any pinned detail', () => {
      const { meta } = workflowMutations.publish('kyc', 3);
      const client = new QueryClient();
      for (const { queryKey } of [
        workflowQueries.document('kyc', 3),
        workflowQueries.detail('kyc', 3),
        workflowQueries.detail('kyc'),
      ]) {
        client.setQueryData<unknown>(queryKey as QueryKey, 'cached');
      }

      for (const queryKey of meta?.invalidates as QueryKey[]) {
        void client.invalidateQueries({ queryKey });
      }

      const stale = (queryKey: QueryKey) => client.getQueryState(queryKey)?.isInvalidated;
      expect(stale(workflowQueries.detail('kyc').queryKey)).toBe(true);
      expect(stale(workflowQueries.detail('kyc', 3).queryKey)).toBe(false);
      expect(stale(workflowQueries.document('kyc', 3).queryKey)).toBe(false);
    });
  });

  describe('compile', () => {
    it('calls compileWorkflowDocument and carries no meta', async () => {
      const options = workflowMutations.compile();
      await options.mutationFn?.(DOCUMENT, {} as never);

      expect(compileWorkflowDocument).toHaveBeenCalledWith(DOCUMENT);
      expect(options.meta).toBeUndefined();
    });
  });

  describe('selectConnector', () => {
    it('puts the connector on the step of the factory workflow', async () => {
      await workflowMutations.selectConnector('kyc').mutationFn?.(
        {
          stepName: 'verify',
          connectorId: 'veriff_kyc',
          target: { scope: 'version', version: 2 },
        },
        {} as never,
      );

      expect(putWorkflowConnectorSelection).toHaveBeenCalledWith('kyc', 'verify', 'veriff_kyc', {
        scope: 'version',
        version: 2,
      });
    });

    it('awaits every read of the family, since a selection can change any version', () => {
      expect(workflowMutations.selectConnector('kyc').meta).toEqual({
        awaits: [workflowQueries.detailsFor('kyc')],
      });
    });
  });

  describe('clearConnector', () => {
    it('deletes the selection on the step of the factory workflow', async () => {
      await workflowMutations
        .clearConnector('kyc')
        .mutationFn?.({ stepName: 'verify', target: { scope: 'all' } }, {} as never);

      expect(deleteWorkflowConnectorSelection).toHaveBeenCalledWith('kyc', 'verify', {
        scope: 'all',
      });
    });

    it('awaits every read of the family', () => {
      expect(workflowMutations.clearConnector('kyc').meta).toEqual({
        awaits: [workflowQueries.detailsFor('kyc')],
      });
    });
  });
});
