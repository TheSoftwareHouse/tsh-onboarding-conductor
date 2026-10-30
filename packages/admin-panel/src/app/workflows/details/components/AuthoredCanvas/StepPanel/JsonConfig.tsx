import { useId, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { input } from '@/components/ui/Input/Input';
import { Typography } from '@/components/ui/Typography/Typography';
import { JSON_INDENT } from '../../../constants/json-indent';

export interface JsonConfigProps {
  config: Record<string, unknown>;
  readOnly: boolean;
  onConfig: (config: Record<string, unknown>) => void;
}

/** A section's config as JSON text, written back only when Apply parses it to an object. */
export function JsonConfig({ config, readOnly, onConfig }: JsonConfigProps): ReactElement {
  const saved = JSON.stringify(config, null, JSON_INDENT);
  const [text, setText] = useState(saved);
  const [seen, setSeen] = useState(saved);
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  // A config changed from outside (undo, the form) replaces what was typed.
  if (saved !== seen) {
    setSeen(saved);
    setText(saved);
    setError(null);
  }

  function apply(): void {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        setError('Config must be an object');
        return;
      }
      setError(null);
      onConfig(value as Record<string, unknown>);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid JSON');
    }
  }

  return (
    <>
      {/* components/ui has no textarea. */}
      <textarea
        aria-label="Config JSON"
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className={input({ font: 'mono', className: 'h-auto min-h-40 py-2' })}
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      {error !== null && (
        <Typography id={errorId} variant="meta" className="text-tsh-red" role="alert">
          {error}
        </Typography>
      )}
      {!readOnly && (
        <Button variant="outline" size="sm" disabled={text === saved} onClick={apply}>
          Apply
        </Button>
      )}
    </>
  );
}
