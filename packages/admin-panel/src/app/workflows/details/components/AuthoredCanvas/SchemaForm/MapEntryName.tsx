import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { findEntryNameProblem } from './form-values';

export interface MapEntryNameProps {
  /** The entry's current key. */
  name: string;
  /** "Field name" for a form's `fields`, "Name" elsewhere. */
  label: string;
  /** Keys already taken by the other entries. */
  taken: readonly string[];
  /** The map's `propertyNames` pattern, when its schema declares one. */
  pattern?: string;
  readOnly: boolean;
  onRename: (name: string) => void;
  /** Sits beside the input, such as the remove button. */
  trailing?: ReactNode;
  /** Muted information under the name, such as references a rename left alone. */
  note?: string;
}

/** The entry's key as an editable heading: commits on Enter or blur, Escape restores it. */
export function MapEntryName({
  name,
  label,
  taken,
  pattern,
  readOnly,
  onRename,
  trailing,
  note,
}: MapEntryNameProps): ReactElement {
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  const commit = (): void => {
    const problem = draft === name ? null : findEntryNameProblem(label, draft, taken, pattern);
    setError(problem);
    if (draft !== name && problem === null) onRename(draft);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Typography as="label" variant="caps-tiny" htmlFor={inputId} className="text-fg-1">
        {label}
      </Typography>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          font="mono"
          size="sm"
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? errorId : undefined}
          className="font-medium"
          disabled={readOnly}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(name);
              setError(null);
            }
          }}
        />
        {trailing}
      </div>
      {error !== null && (
        <Typography id={errorId} variant="meta" role="alert" className="text-tsh-red">
          {error}
        </Typography>
      )}
      {note !== undefined && (
        <Typography variant="meta" role="status">
          {note}
        </Typography>
      )}
    </div>
  );
}
