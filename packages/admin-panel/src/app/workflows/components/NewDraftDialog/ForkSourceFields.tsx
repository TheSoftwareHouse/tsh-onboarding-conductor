import type { ReactElement } from 'react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { WORKFLOW_VERSION_STATUS } from '@/api/workflows/workflow-versions';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { Button } from '@/components/ui/Button/Button';
import {
  Combobox,
  type ComboboxInputReason,
  type ComboboxItem,
} from '@/components/ui/Combobox/Combobox';
import { FormField } from '@/components/ui/form/FormField/FormField';
import { Select } from '@/components/ui/Select/Select';
import { StatusRegion } from '@/components/ui/StatusRegion/StatusRegion';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { ForkSource } from '../../utils/new-draft-schema';
import { defaultForkVersion, nextWorkflowVersion } from '../../utils/workflow-version-picks';

const SEARCH_DELAY_MS = 300;
const SEARCH_LIMIT = 20;
// Pages keep loading until this many forkable families show, so the list can scroll to load more.
const MIN_FAMILY_ITEMS = 20;
const SUMMARY_LIMIT = 100;
// The engine refuses a longer `search` with a 400.
const MAX_SEARCH_LENGTH = 100;

export interface InitialFork {
  workflowId: string;
  version: number;
}

/** The identity fields a chosen fork source fills in. */
export interface ForkPrefill {
  fork: ForkSource;
  workflowId: string;
  version: string;
  name: string;
}

interface UseForkSourceOptions {
  initialFork?: InitialFork;
  /** Whether Fork is the chosen source; a late document never prefills another one. */
  isActive: boolean;
  onPrefill: (prefill: ForkPrefill) => void;
  /** Called when the chosen source changes, before its document has loaded. */
  onReset: () => void;
}

function toItem(summary: AdminWorkflowSummary): ComboboxItem {
  const { workflowId, name, scope } = summary;
  return {
    value: workflowId,
    label: name ?? workflowId,
    description: name === null ? scope : `${workflowId} · ${scope}`,
  };
}

/** The fork source's reads and choices: the family, its version, and the document that prefills the form. */
export function useForkSource({ initialFork, isActive, onPrefill, onReset }: UseForkSourceOptions) {
  const [inputText, setInputText] = useState<string | null>(null);
  // The source last prefilled, so returning to Fork keeps the operator's edits; a pick forgets it.
  const prefilledSource = useRef<string | null>(null);
  // `undefined` until the operator picks, so a preselected family shows without a pick.
  const [pickedFamily, setPickedFamily] = useState<AdminWorkflowSummary | null | undefined>();
  const [pickedVersion, setPickedVersion] = useState<number | null>(initialFork?.version ?? null);
  const search = useDebouncedValue(inputText ?? '', SEARCH_DELAY_MS)
    .trim()
    .slice(0, MAX_SEARCH_LENGTH);

  const listQuery = useInfiniteQuery(
    workflowQueries.listPages({
      limit: SEARCH_LIMIT,
      search: search || null,
      scope: null,
      hasDraft: null,
    }),
  );
  const listRecords = listQuery.data?.pages.flatMap((page) => page.records) ?? [];
  // A draft-only family has nothing to fork, and the list endpoint cannot leave it out.
  const familyItems = listRecords
    .filter((record) => record.versionCount - record.draftCount > 0)
    .map(toItem);
  const { fetchNextPage } = listQuery;
  const canLoadMore = listQuery.hasNextPage && !listQuery.isFetching && !listQuery.isError;
  const loadMore = (): void => {
    if (canLoadMore) {
      void fetchNextPage();
    }
  };

  useEffect(() => {
    if (canLoadMore && familyItems.length < MIN_FAMILY_ITEMS) {
      void fetchNextPage();
    }
  }, [canLoadMore, familyItems.length, fetchNextPage]);
  const summaryQuery = useQuery({
    ...workflowQueries.list({
      page: 1,
      limit: SUMMARY_LIMIT,
      search: initialFork?.workflowId ?? null,
      scope: null,
      hasDraft: null,
    }),
    enabled: initialFork !== undefined,
  });

  const preselected = summaryQuery.data?.records.find(
    (record) => record.workflowId === initialFork?.workflowId,
  );
  const family = pickedFamily === undefined ? preselected : pickedFamily;
  const familyId = family?.workflowId ?? '';

  const versionsQuery = useQuery({
    ...workflowQueries.versions(familyId),
    enabled: family != null,
  });
  const versions = versionsQuery.data;
  const version = pickedVersion ?? (versions === undefined ? null : defaultForkVersion(versions));

  const documentQuery = useQuery({
    ...workflowQueries.document(familyId, version ?? 0),
    enabled: family != null && version !== null,
  });
  const document = documentQuery.data;

  const prefill = useEffectEvent(() => {
    if (!isActive || family == null || versions === undefined || document === undefined) {
      return;
    }
    const sourceKey = `${family.workflowId}@${version}`;
    if (prefilledSource.current === sourceKey) {
      return;
    }
    prefilledSource.current = sourceKey;
    const isUsers = family.scope === 'users';
    const name = document.document.name;
    onPrefill({
      fork: { workflowId: family.workflowId, scope: family.scope, document: document.document },
      workflowId: isUsers ? family.workflowId : '',
      version: isUsers ? String(nextWorkflowVersion(versions)) : '1',
      name: typeof name === 'string' ? name : '',
    });
  });

  useEffect(() => {
    prefill();
  }, [document, versions, family, isActive]);

  const isLookingUp = initialFork !== undefined && summaryQuery.isPending;
  const failed = [listQuery, summaryQuery, versionsQuery, documentQuery].filter(
    (query) => query.isError,
  );

  return {
    family,
    versions,
    version,
    familyItems,
    loadMore,
    selectedItem: family == null ? null : toItem(family),
    inputValue: inputText ?? (family == null ? '' : toItem(family).label),
    isSearching: listQuery.isFetching || isLookingUp,
    listFailed: listQuery.isError,
    isLoading:
      isLookingUp ||
      (family != null &&
        (versionsQuery.isPending || (version !== null && documentQuery.isPending))),
    hasFailed: failed.length > 0,
    retry: () => {
      failed.forEach((query) => void query.refetch());
    },
    // Only typing searches; Base UI also writes a chosen item's label into the input.
    setInputText: (text: string, reason: ComboboxInputReason) => {
      setInputText(reason === 'input-change' ? text : null);
    },
    pickFamily: (item: ComboboxItem | null) => {
      if (item?.value === family?.workflowId) {
        return;
      }
      setPickedFamily(listRecords.find((record) => record.workflowId === item?.value) ?? null);
      setPickedVersion(null);
      prefilledSource.current = null;
      onReset();
    },
    pickVersion: (next: string) => {
      if (Number(next) === version) {
        return;
      }
      setPickedVersion(Number(next));
      prefilledSource.current = null;
      onReset();
    },
    /** Prefills the chosen source again once Fork is active, discarding the identity fields' values. */
    refill: () => {
      prefilledSource.current = null;
    },
  };
}

export type ForkSourceState = ReturnType<typeof useForkSource>;

export interface ForkSourceFieldsProps {
  source: ForkSourceState;
  idPrefix: string;
}

/** The Workflow combobox and Version select a fork starts from, with their load and error states. */
export function ForkSourceFields({ source, idPrefix }: ForkSourceFieldsProps): ReactElement {
  const familyId = `${idPrefix}-source-workflow`;
  const versionId = `${idPrefix}-source-version`;
  const versionItems = (source.versions ?? [])
    .filter((entry) => entry.status !== WORKFLOW_VERSION_STATUS.draft)
    .map((entry) => ({
      value: String(entry.version),
      label: `v${entry.version} — ${entry.status}`,
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField controlId={familyId} label="Source workflow">
          <Combobox
            id={familyId}
            items={source.familyItems}
            value={source.selectedItem}
            onValueChange={source.pickFamily}
            inputValue={source.inputValue}
            onInputValueChange={source.setInputText}
            placeholder="Search by ID or name"
            loading={source.isSearching}
            error={source.listFailed ? 'Could not load workflows.' : null}
            emptyText="No workflow with a published or retired version."
            onLoadMore={source.loadMore}
          />
        </FormField>
        <FormField controlId={versionId} label="Source version">
          <Select
            id={versionId}
            items={versionItems}
            value={source.version === null ? null : String(source.version)}
            onValueChange={source.pickVersion}
            placeholder={source.isLoading ? 'Loading…' : 'Choose a version'}
            disabled={source.family == null || source.versions === undefined}
          />
        </FormField>
      </div>
      {source.hasFailed && (
        <div className="flex items-center gap-3">
          <StatusRegion>Could not load the source workflow.</StatusRegion>
          <Button variant="outline" size="sm" onClick={source.retry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
