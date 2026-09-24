import type { ChangeEvent, ReactElement } from 'react';
import {
  CUSTOM_PERIOD,
  DATE_TIME_PERIODS,
  describeDateTimePeriod,
  type DateTimeRangePeriod,
} from '@/lib/datetime-period';
import { resolveLocalTimeZoneName } from '@/lib/datetime-local';
import { input } from '@/components/ui/Input/Input';
import { DateTimePickerField } from '../DateTimePickerField/DateTimePickerField';
import { FilterField } from '../FilterField';

/** A window: either a relative period, or the two absolute bounds `custom` carries — never both. */
export interface DateTimeRange {
  period: DateTimeRangePeriod;
  from: string;
  to: string;
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
 * The window a trail is read through, as one select over the relative periods plus the two bounds
 * that state an absolute window.
 *
 * The select reads `value.period` back directly, so it always reports the choice that was made.
 * An earlier revision stored the resolved instant instead and re-derived the selection by
 * comparing it against the clock, which meant the control drifted onto `Custom range…` a minute
 * after a period was picked.
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
  const timeZone = resolveLocalTimeZoneName();
  const selectId = `${idPrefix}-period`;
  const custom = value.period === CUSTOM_PERIOD;

  const handlePeriodChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const period = event.target.value as DateTimeRangePeriod;

    // `Custom range…` keeps whatever bounds are already entered, so reaching it costs nothing;
    // every other choice is a period, which clears them.
    onChange(
      period === CUSTOM_PERIOD
        ? { period, from: value.from, to: value.to }
        : { period, from: '', to: '' },
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
        value={value.period}
        onChange={handlePeriodChange}
        className={input()}
      >
        <option value="">All time</option>
        {DATE_TIME_PERIODS.map((period) => (
          <option key={period} value={period}>
            {describeDateTimePeriod(period)}
          </option>
        ))}
        <option value={CUSTOM_PERIOD}>Custom range…</option>
      </select>
      {timeZone.length > 0 && <span className="text-caps-tiny text-fg-4">{timeZone}</span>}
      {custom && (
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
