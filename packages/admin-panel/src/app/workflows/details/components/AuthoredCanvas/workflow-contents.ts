import { createContext, useContext, useMemo } from 'react';
import type { AutocompleteItem } from '@/components/ui/Autocomplete/Autocomplete';
import type { WorkflowContents } from '../../utils/authored-projection';

/** The projection's `contents`, for controls nested in recursive forms and conditions that name a field or a score. */
export const WorkflowContentsContext = createContext<WorkflowContents>({ fields: [], scores: [] });

export function useWorkflowContents(): WorkflowContents {
  return useContext(WorkflowContentsContext);
}

/** Every stored field as a suggestion, with its type beside it. */
export function useFieldSuggestions(): AutocompleteItem[] {
  const { fields } = useWorkflowContents();
  return useMemo(
    () =>
      fields.map(({ name, type }) =>
        type === null ? { value: name } : { value: name, description: type },
      ),
    [fields],
  );
}
