import type { ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { Input } from '@/components/ui/Input/Input';
import { Add, Close } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select/Select';
import { Typography } from '@/components/ui/Typography/Typography';
import { FIELD_TYPE } from '@tsh/ddl-schema/workflow-contract';
import { FieldRow } from '../FieldRow';
import { parseNumberInput, setMember } from '../form-values';
import { ANY, type ValidationEditorProps } from './validation-values';

export type AllowedValuesKind =
  typeof FIELD_TYPE.text | typeof FIELD_TYPE.number | typeof FIELD_TYPE.date;

type Mode = 'oneOf' | 'manyOf' | typeof ANY;
/** `null` is a cleared number box: JSON has no `undefined` inside a list. */
type Entry = string | number | null;

const MODES: Record<Mode, { label: string; help?: string }> = {
  [ANY]: { label: 'Any value' },
  oneOf: { label: 'Pick one of', help: 'The applicant chooses exactly one of these' },
  manyOf: {
    label: 'Pick several of',
    help: 'The applicant may choose several of these; the value is a list',
  },
};

const MODE_ITEMS = (Object.keys(MODES) as Mode[]).map((mode) => ({
  value: mode,
  label: MODES[mode].label,
}));

const STARTING_ENTRY: Record<AllowedValuesKind, Entry> = { text: '', number: 0, date: '' };

function readMode(value: Record<string, unknown>): Mode {
  if ('oneOf' in value) return 'oneOf';
  if ('manyOf' in value) return 'manyOf';
  return ANY;
}

function readEntries(value: Record<string, unknown>): Entry[] {
  const list = value.oneOf ?? value.manyOf;
  return Array.isArray(list) ? list : [];
}

/** One mode select over `oneOf` and `manyOf`, so the engine's exclusivity can never be broken. */
export function AllowedValues({
  kind,
  value,
  onChange,
  readOnly,
}: ValidationEditorProps & { kind: AllowedValuesKind }): ReactElement {
  const mode = readMode(value);
  const entries = readEntries(value);

  const changeMode = (next: Mode): void => {
    const cleared = setMember(setMember(value, 'oneOf', undefined), 'manyOf', undefined);
    onChange(
      next === ANY
        ? cleared
        : setMember(cleared, next, entries.length > 0 ? entries : [STARTING_ENTRY[kind]]),
    );
  };
  const writeEntries = (next: Entry[]): void => {
    if (mode !== ANY) onChange(setMember(value, mode, next));
  };

  return (
    <div className="flex flex-col gap-2">
      <FieldRow label="Allowed values" required={false}>
        <Select
          aria-label="Allowed values"
          items={MODE_ITEMS}
          value={mode}
          disabled={readOnly}
          onValueChange={changeMode}
        />
      </FieldRow>
      {mode !== ANY && (
        <>
          <Typography variant="meta" as="p">
            {MODES[mode].help}
          </Typography>
          {entries.map((entry, index) => (
            <div
              // Entries have no identity of their own; removing one re-keys the rest.
              key={index}
              className="flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <Input
                  type={kind}
                  font={kind === FIELD_TYPE.date ? 'text' : 'mono'}
                  size="sm"
                  aria-label={`Allowed value ${index + 1}`}
                  disabled={readOnly}
                  value={entry ?? ''}
                  onChange={(event) =>
                    writeEntries(
                      entries.map((current, at) =>
                        at !== index
                          ? current
                          : kind === FIELD_TYPE.number
                            ? (parseNumberInput(event.target.value) ?? null)
                            : event.target.value,
                      ),
                    )
                  }
                />
              </div>
              {!readOnly && entries.length > 1 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="h-6 px-1"
                  aria-label={`Remove allowed value ${index + 1}`}
                  onClick={() => writeEntries(entries.filter((_, at) => at !== index))}
                >
                  <Close aria-hidden className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button
              size="sm"
              className="self-start"
              aria-label="Add allowed value"
              onClick={() => writeEntries([...entries, STARTING_ENTRY[kind]])}
            >
              <Add aria-hidden className="size-4" />
              Add
            </Button>
          )}
        </>
      )}
    </div>
  );
}
