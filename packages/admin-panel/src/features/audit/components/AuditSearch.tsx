import { useState, type ReactElement } from 'react';
import { SearchInput } from '@/shared/components/SearchInput/SearchInput';

export interface AuditSearchProps {
  /** Seeds the draft once, exactly as the panel's other filter drafts are seeded. */
  value: string;
  disabled?: boolean;
  onSubmit: (resourceId: string) => void;
}

/** The design's header search box, committing `resourceId` on submit. */
export function AuditSearch({ value, disabled, onSubmit }: AuditSearchProps): ReactElement {
  const [draft, setDraft] = useState(value);

  return (
    <SearchInput
      label="Resource ID"
      placeholder="Resource ID"
      value={draft}
      disabled={disabled}
      onChange={setDraft}
      onSubmit={() => onSubmit(draft.trim())}
    />
  );
}
