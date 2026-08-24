import type { ReactElement } from 'react';
import {
  minutesAgoDateTimeLocalValue,
  resolveLocalTimeZoneName,
} from '@/shared/lib/datetime-local';

/** Both bounds of a time window, as the datetime controls carry them. */
export interface DateTimeRange {
  from: string;
  to: string;
}

interface QuickRange {
  label: string;
  /** How far back from now the window opens. Its far end is left open. */
  minutes: number;
}

/**
 * Windows an audit trail is almost always read through, offered as one click each so the common
 * case never needs a date picked. Ordered shortest first, which is the order they are reached for.
 *
 * Each one only opens the window and leaves its far end empty, so "Last hour" keeps meaning the
 * last hour as time passes rather than freezing at the minute the shortcut was pressed.
 */
const QUICK_RANGES: readonly QuickRange[] = [
  { label: 'Last hour', minutes: 60 },
  { label: 'Last 24 hours', minutes: 60 * 24 },
  { label: 'Last 7 days', minutes: 60 * 24 * 7 },
  { label: 'Last 30 days', minutes: 60 * 24 * 30 },
];

export interface DateTimeQuickRangesProps {
  /** What the window is measured on, naming the pair of fields these shortcuts fill in. */
  legend: string;
  value: DateTimeRange;
  disabled: boolean;
  onChange: (value: DateTimeRange) => void;
}

/**
 * The time window as a row of shortcuts, and the zone its bounds are read in.
 *
 * Both bounds are set together here rather than in either field, because a window is one criterion
 * even though it is entered as two, and because a shortcut is not a field: it belongs in the
 * panel's header, where it costs the grid of criteria no row of its own.
 */
export function DateTimeQuickRanges({
  legend,
  value,
  disabled,
  onChange,
}: DateTimeQuickRangesProps): ReactElement {
  const timeZone = resolveLocalTimeZoneName();
  const hasWindow = value.from.length > 0 || value.to.length > 0;
  const name = timeZone.length > 0 ? `${legend} (${timeZone})` : legend;

  return (
    <div className="quick-ranges" role="group" aria-label={name}>
      <span className="quick-ranges__legend">{name}</span>
      {QUICK_RANGES.map((range) => (
        <button
          key={range.label}
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => onChange({ from: minutesAgoDateTimeLocalValue(range.minutes), to: '' })}
        >
          {range.label}
        </button>
      ))}
      <button
        type="button"
        className="chip chip--quiet"
        disabled={disabled || !hasWindow}
        onClick={() => onChange({ from: '', to: '' })}
      >
        Clear
      </button>
    </div>
  );
}
