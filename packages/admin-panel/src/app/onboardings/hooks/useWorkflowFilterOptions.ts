import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import { WORKFLOW_VERSION_STATUS } from '@/api/workflows/workflow-versions';
import type { ComboboxInputReason, ComboboxItem } from '@/components/ui/Combobox/Combobox';
import type { FilterOption } from '@/components/ui/filters/SelectFilterField/SelectFilterField';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const SEARCH_DELAY_MS = 300;
const SEARCH_LIMIT = 20;
// Pages keep loading until this many families show, so the list can scroll to load more.
const MIN_FAMILY_ITEMS = 20;
const SUMMARY_LIMIT = 100;
// The engine refuses a longer `search` with a 400.
const MAX_SEARCH_LENGTH = 100;

function toItem(summary: AdminWorkflowSummary): ComboboxItem {
  const { workflowId, name, scope } = summary;
  return {
    value: workflowId,
    label: name ?? workflowId,
    description: name === null ? scope : `${workflowId} · ${scope}`,
  };
}

/** The Workflow combobox's items and the Version select's options for the drafted workflow id and version. */
export function useWorkflowFilterOptions(workflowId: string, workflowVersion: string) {
  const [inputText, setInputText] = useState<string | null>(null);
  // The last pick, kept so the label survives until the lists catch up with it.
  const [picked, setPicked] = useState<ComboboxItem | null>(null);
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
  // A draft-only family has no onboarding to filter by, and the list endpoint cannot leave it out.
  const items = listRecords
    .filter((record) => record.versionCount - record.draftCount > 0)
    .map(toItem);
  const { fetchNextPage } = listQuery;
  const canLoadMore = listQuery.hasNextPage && !listQuery.isFetching && !listQuery.isError;

  useEffect(() => {
    if (canLoadMore && items.length < MIN_FAMILY_ITEMS) {
      void fetchNextPage();
    }
  }, [canLoadMore, items.length, fetchNextPage]);

  const loaded = listRecords.find((record) => record.workflowId === workflowId);
  const lookupQuery = useQuery({
    ...workflowQueries.list({
      page: 1,
      limit: SUMMARY_LIMIT,
      search: workflowId,
      scope: null,
      hasDraft: null,
    }),
    enabled: workflowId !== '' && loaded === undefined,
  });
  const found =
    loaded ?? lookupQuery.data?.records.find((record) => record.workflowId === workflowId);

  let selectedItem: ComboboxItem | null = null;
  if (workflowId !== '') {
    if (picked?.value === workflowId) {
      selectedItem = picked;
    } else {
      selectedItem = found === undefined ? { value: workflowId, label: workflowId } : toItem(found);
    }
  }

  const versionsQuery = useQuery({
    ...workflowQueries.versions(workflowId),
    enabled: workflowId !== '',
  });
  const versionOptions: FilterOption[] = (versionsQuery.data ?? [])
    .filter((entry) => entry.status !== WORKFLOW_VERSION_STATUS.draft)
    .map((entry) => ({
      value: String(entry.version),
      label: `v${entry.version} — ${entry.status}`,
    }));
  // A version the list does not hold (a version-only URL, a failed or stale lookup) still shows as chosen.
  if (
    workflowVersion !== '' &&
    !versionOptions.some((option) => option.value === workflowVersion)
  ) {
    versionOptions.push({ value: workflowVersion, label: `v${workflowVersion}` });
  }

  return {
    items,
    selectedItem,
    inputValue: inputText ?? selectedItem?.label ?? '',
    // Only typing searches; Base UI also writes a chosen item's label into the input.
    setInputText: (text: string, reason: ComboboxInputReason): void => {
      setInputText(reason === 'input-change' ? text : null);
    },
    pick: (item: ComboboxItem | null): void => {
      setPicked(item);
    },
    loadMore: (): void => {
      if (canLoadMore) {
        void fetchNextPage();
      }
    },
    isSearching: listQuery.isFetching || lookupQuery.isFetching,
    listFailed: listQuery.isError,
    versionOptions,
    versionsLoading: workflowId !== '' && versionsQuery.isPending,
    versionsFailed: versionsQuery.isError,
  };
}
