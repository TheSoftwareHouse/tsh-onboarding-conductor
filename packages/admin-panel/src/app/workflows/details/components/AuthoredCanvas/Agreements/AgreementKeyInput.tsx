import { useId, useState, type ReactElement } from 'react';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { findAgreementKeyProblem, type Agreement } from '../../../utils/agreements';

export interface AgreementKeyInputProps {
  agreements: readonly Agreement[];
  /** The agreement this box edits, by its place in `agreements`. */
  index: number;
  label: string;
  readOnly: boolean;
  onKey: (key: string) => void;
}

/** An agreement's key; a key the engine would refuse stays in the box with its reason and is not written. */
export function AgreementKeyInput({
  agreements,
  index,
  label,
  readOnly,
  onKey,
}: AgreementKeyInputProps): ReactElement {
  const key = agreements[index]?.key ?? '';
  // Holds the text only while it is not a valid key, so a valid edit shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(key);
  if (draftKey !== key) {
    setDraftKey(key);
    setDraft(null);
  }
  const errorId = useId();
  const problem = draft === null ? null : findAgreementKeyProblem(agreements, index, draft);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Input
        font="mono"
        size="sm"
        aria-label={label}
        aria-invalid={problem !== null}
        aria-describedby={problem !== null ? errorId : undefined}
        readOnly={readOnly}
        value={draft ?? key}
        onChange={(event) => {
          const next = event.target.value;
          const invalid = findAgreementKeyProblem(agreements, index, next) !== null;
          setDraft(invalid ? next : null);
          if (!invalid) onKey(next);
        }}
      />
      {problem !== null && (
        <Typography id={errorId} variant="meta" className="text-tsh-red" role="alert">
          {problem}
        </Typography>
      )}
    </div>
  );
}
