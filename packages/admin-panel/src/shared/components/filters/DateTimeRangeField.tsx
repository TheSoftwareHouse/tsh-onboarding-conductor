import { useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import {
  minutesAgoDateTimeLocalValue,
  resolveLocalTimeZoneName,
} from '@/shared/lib/datetime-local';
import { DateTimePickerField } from './DateTimePickerField';
import { FilterField, filterControl } from './FilterField';

/** Both bounds of a time window, as the datetime controls carry them. */
export interface DateTimeRange {
  from: string;
  to: string;
}

export interface DateTimeRangePreset {
  label: string;
  /** Minutes the window opens before now, or `null` for the preset that clears both bounds. */
  minutes: number | null;
}

/** Not a preset minute count, so it can never collide with one. */
const CUSTOM_RANGE = 'custom';

const PRESETS: readonly DateTimeRangePreset[] = [
  { label: 'All time', minutes: null },
  { label: 'Last hour', minutes: 60 },
  { label: 'Last 24 hours', minutes: 60 * 24 },
  { label: 'Last 7 days', minutes: 60 * 24 * 7 },
  { label: 'Last 30 days', minutes: 60 * 24 * 30 },
];

function optionValue(preset: DateTimeRangePreset): string {
  return preset.minutes === null ? '' : String(preset.minutes);
}

/**
 * Which option a window matches, or `custom` when only the two bound fields can express it: a set
 * `to`, or a `from` that is not one of the presets' instants.
 */
function matchPreset(value: DateTimeRange): string {
  if (value.to.length > 0) {
    return CUSTOM_RANGE;
  }

  const preset = PRESETS.find((candidate) =>
    candidate.minutes === null
      ? value.from.length === 0
      : value.from === minutesAgoDateTimeLocalValue(candidate.minutes),
  );

  return preset === undefined ? CUSTOM_RANGE : optionValue(preset);
}

export interface DateTimeRangeFieldProps {
  label: string;
  /** Ids the select and the two custom bounds are built from. */
  idPrefix: string;
  /** Query keys the bounds map to, carried as their control names so the form reads as the query. */
  fromName: string;
  toName: string;
  value: DateTimeRange;
  disabled: boolean;
  describedBy?: string;
  invalid?: boolean;
  onChange: (value: DateTimeRange) => void;
}

/**
 * The window a trail is read through, as one preset select plus the two bound fields a preset
 * cannot express.
 *
 * Picking `Custom range…` only reveals those fields; it never calls `onChange` itself, so trying
 * it and backing out of it costs the committed value nothing. Because of that, whether the select
 * is a preset or `custom` is not always derivable from `value` alone, so which one is showing is
 * its own state, seeded once from `value` on mount.
 */
export function DateTimeRangeField({
  label,
  idPrefix,
  fromName,
  toName,
  value,
  disabled,
  describedBy,
  invalid,
  onChange,
}: DateTimeRangeFieldProps): ReactElement {
  const [forcedCustom, setForcedCustom] = useState(() => matchPreset(value) === CUSTOM_RANGE);
  const selected = forcedCustom ? CUSTOM_RANGE : matchPreset(value);
  const timeZone = resolveLocalTimeZoneName();
  const selectId = `${idPrefix}-preset`;

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (next === CUSTOM_RANGE) {
      setForcedCustom(true);
      return;
    }

    setForcedCustom(false);
    onChange(
      next.length === 0
        ? { from: '', to: '' }
        : { from: minutesAgoDateTimeLocalValue(Number(next)), to: '' },
    );
  };

  return (
    <FilterField controlId={selectId} label={label}>
      <select
        id={selectId}
        name={selectId}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        value={selected}
        onChange={handlePresetChange}
        className={filterControl()}
      >
        {PRESETS.map((preset) => (
          <option key={preset.label} value={optionValue(preset)}>
            {preset.label}
          </option>
        ))}
        <option value={CUSTOM_RANGE}>Custom range…</option>
      </select>
      {timeZone.length > 0 && <span className="text-caps-tiny text-fg-4">{timeZone}</span>}
      {selected === CUSTOM_RANGE && (
        <div className="flex flex-wrap gap-2">
          <DateTimePickerField
            id={`${idPrefix}-from`}
            name={fromName}
            label="From"
            describedBy={describedBy}
            invalid={invalid}
            disabled={disabled}
            value={value.from}
            onChange={(from) => onChange({ ...value, from })}
          />
          <DateTimePickerField
            id={`${idPrefix}-to`}
            name={toName}
            label="To"
            describedBy={describedBy}
            invalid={invalid}
            disabled={disabled}
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
          />
        </div>
      )}
    </FilterField>
  );
}
