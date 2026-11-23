import { useState, type ReactElement } from 'react';
import { Input } from '@/components/ui/Input/Input';

export interface JsonValueInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  label: string;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

/** Free-form JSON values (connector config): plain text for strings, JSON for anything else. */
export function JsonValueInput({
  value,
  onChange,
  readOnly,
  label,
}: JsonValueInputProps): ReactElement {
  const [draft, setDraft] = useState(formatValue(value));
  const [seen, setSeen] = useState(value);
  // A value changed from outside (undo, the JSON tab) replaces what was typed.
  if (value !== seen) {
    setSeen(value);
    setDraft(formatValue(value));
  }

  return (
    <Input
      font="mono"
      size="sm"
      aria-label={label}
      disabled={readOnly}
      value={draft}
      title="Text, or JSON for numbers, booleans, lists and objects"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        // The string "2" shows as `2`, so parsing untouched text would turn it into a number.
        if (draft === formatValue(value)) return;
        try {
          onChange(JSON.parse(draft));
        } catch {
          onChange(draft);
        }
      }}
    />
  );
}
