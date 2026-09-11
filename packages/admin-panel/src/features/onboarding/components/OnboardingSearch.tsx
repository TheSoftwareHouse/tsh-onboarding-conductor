import { useState, type ReactElement } from 'react';
import { SearchInput } from '@/shared/components/SearchInput/SearchInput';

export interface OnboardingSearchProps {
  /** Seeds the draft once, exactly as the panel's other filter drafts are seeded. */
  value: string;
  disabled?: boolean;
  onSubmit: (onboardingId: string) => void;
}

/** The design's header search box, committing `onboardingId` on submit. */
export function OnboardingSearch({
  value,
  disabled,
  onSubmit,
}: OnboardingSearchProps): ReactElement {
  const [draft, setDraft] = useState(value);

  return (
    <SearchInput
      label="Onboarding ID"
      placeholder="Onboarding ID"
      value={draft}
      disabled={disabled}
      onChange={setDraft}
      onSubmit={() => onSubmit(draft.trim())}
    />
  );
}
