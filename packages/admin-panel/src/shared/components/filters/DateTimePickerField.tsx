import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import {
  addDays,
  addMonths,
  buildMonthDays,
  formatDayLabel,
  formatMonthTitle,
  isSameDay,
  isSameMonth,
  startOfMonth,
  WEEKDAY_LABELS,
} from '@/shared/lib/calendar-month';
import {
  parseDateTimeLocalValue,
  timeOfDayFromValue,
  toDateTimeLocalValue,
  toDateTimeLocalValueParts,
} from '@/shared/lib/datetime-local';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { FilterField, type FilterControlProps } from './FilterField';

/** What an unset bound reads as, naming what leaving it unset means rather than saying nothing. */
const PLACEHOLDER = 'Any time';

/** Time a day is taken to start at when a date is chosen before any time is. */
const DEFAULT_TIME_OF_DAY = '00:00';

export interface DateTimePickerFieldProps extends FilterControlProps {
  /** `datetime-local` control value in the operator's own time zone, or empty. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * A date and time chosen from one calendar: a month of days, a time of day beneath it, and the
 * shortcuts for now and for clearing the bound.
 *
 * The calendar is the panel's own rather than the browser's because a `datetime-local` control
 * renders a picker no stylesheet can reach - a different shape, density, and set of controls in
 * every browser - and because a bound that can be cleared and set to now needs actions the native
 * picker has nowhere to put.
 *
 * The field itself is read-only: the value is always one the calendar produced, so it can never be
 * a half-typed date the panel has to refuse. Backspace still clears it, as it would a typed one.
 */
export function DateTimePickerField({
  id,
  name,
  label,
  value,
  disabled,
  describedBy,
  invalid,
  onChange,
}: DateTimePickerFieldProps): ReactElement {
  const selected = parseDateTimeLocalValue(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));
  // The one day the grid offers to the keyboard, moved by the arrow keys as a roving tab stop so
  // the calendar is one stop in the panel's tab order rather than forty-two.
  const [focusedDay, setFocusedDay] = useState(() => selected ?? new Date());
  // Whether the calendar hangs from the control's trailing edge, which it does only when hanging
  // from the leading one would put it off the side of the window.
  const [alignToEnd, setAlignToEnd] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLInputElement>(null);
  const focusedDayRef = useRef<HTMLButtonElement>(null);
  // Whether focus should follow the roving day, which it does only while the grid is being walked
  // by keyboard - never when a month button was pressed, which would take focus off that button.
  const focusFollowsDay = useRef(false);

  const today = new Date();
  const days = buildMonthDays(viewMonth);
  const tabbableDay = isSameMonth(focusedDay, viewMonth) ? focusedDay : startOfMonth(viewMonth);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    const calendar = calendarRef.current;
    if (!open || calendar === null) {
      return;
    }

    const { right } = calendar.getBoundingClientRect();
    if (right > document.documentElement.clientWidth) {
      setAlignToEnd(true);
    }
  }, [open]);

  useEffect(() => {
    if (open && focusFollowsDay.current) {
      focusFollowsDay.current = false;
      focusedDayRef.current?.focus();
    }
  });

  const openCalendar = (): void => {
    const anchor = selected ?? new Date();
    setAlignToEnd(false);
    setViewMonth(startOfMonth(anchor));
    setFocusedDay(anchor);
    focusFollowsDay.current = true;
    setOpen(true);
  };

  const closeCalendar = (): void => {
    setOpen(false);
    controlRef.current?.focus();
  };

  const moveFocusedDay = (next: Date): void => {
    setFocusedDay(next);
    setViewMonth(startOfMonth(next));
    focusFollowsDay.current = true;
  };

  const selectDay = (day: Date): void => {
    setFocusedDay(day);
    onChange(toDateTimeLocalValueParts(day, timeOfDayFromValue(value, DEFAULT_TIME_OF_DAY)));
  };

  const selectTimeOfDay = (timeOfDay: string): void => {
    if (timeOfDay.length === 0) {
      onChange(selected === null ? '' : toDateTimeLocalValueParts(selected, DEFAULT_TIME_OF_DAY));
      return;
    }

    onChange(toDateTimeLocalValueParts(selected ?? focusedDay, timeOfDay));
  };

  const selectNow = (): void => {
    const now = new Date();
    setViewMonth(startOfMonth(now));
    setFocusedDay(now);
    onChange(toDateTimeLocalValue(now));
  };

  const clear = (): void => {
    onChange('');
    closeCalendar();
  };

  const handleControlKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      // Enter would otherwise submit the panel from a field the operator meant to open.
      event.preventDefault();
      openCalendar();
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      onChange('');
      return;
    }

    // Reachable when the calendar was opened by pointer and focus was taken back to the control.
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeCalendar();
    }
  };

  const handleCalendarKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCalendar();
      return;
    }

    const step = CALENDAR_STEPS[event.key];
    if (step === undefined) {
      return;
    }

    event.preventDefault();
    moveFocusedDay(step(tabbableDay));
  };

  return (
    <FilterField controlId={id} label={label}>
      <div className="datetime-field" ref={containerRef}>
        <input
          id={id}
          name={name}
          ref={controlRef}
          type="text"
          className="datetime-field__control"
          readOnly
          autoComplete="off"
          placeholder={PLACEHOLDER}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          value={value.length === 0 ? '' : formatDateTime(value)}
          onClick={() => (open ? setOpen(false) : openCalendar())}
          onKeyDown={handleControlKeyDown}
        />
        {open && (
          <div
            ref={calendarRef}
            className={alignToEnd ? 'calendar calendar--end' : 'calendar'}
            role="dialog"
            aria-label={`${label}: choose a date and time`}
            onKeyDown={handleCalendarKeyDown}
          >
            <div className="calendar__header">
              <button
                type="button"
                className="calendar__step"
                aria-label="Previous month"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              >
                ‹
              </button>
              <span className="calendar__month" aria-live="polite">
                {formatMonthTitle(viewMonth)}
              </span>
              <button
                type="button"
                className="calendar__step"
                aria-label="Next month"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              >
                ›
              </button>
            </div>
            <div className="calendar__grid">
              {WEEKDAY_LABELS.map((weekday) => (
                <span key={weekday} className="calendar__weekday" aria-hidden="true">
                  {weekday.slice(0, 2)}
                </span>
              ))}
              {days.map((day, cell) =>
                day === null ? (
                  // A blank cell has no identity beyond its place in the grid.
                  <span key={`blank-${cell}`} className="calendar__blank" />
                ) : (
                  <button
                    key={day.getDate()}
                    type="button"
                    ref={isSameDay(day, tabbableDay) ? focusedDayRef : undefined}
                    className={dayClassName(day, selected, today)}
                    tabIndex={isSameDay(day, tabbableDay) ? 0 : -1}
                    aria-label={formatDayLabel(day)}
                    aria-pressed={selected !== null && isSameDay(day, selected)}
                    aria-current={isSameDay(day, today) ? 'date' : undefined}
                    onClick={() => selectDay(day)}
                  >
                    {day.getDate()}
                  </button>
                ),
              )}
            </div>
            <div className="calendar__time">
              <label htmlFor={`${id}-time`}>Time</label>
              <input
                id={`${id}-time`}
                type="time"
                value={timeOfDayFromValue(value, '')}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  selectTimeOfDay(event.target.value)
                }
              />
            </div>
            <div className="calendar__actions">
              <button type="button" className="chip" onClick={selectNow}>
                Now
              </button>
              <button type="button" className="chip chip--quiet" onClick={clear}>
                Clear
              </button>
              <button type="button" className="chip chip--accent" onClick={closeCalendar}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </FilterField>
  );
}

/** How far each navigation key moves through the calendar, from the day the grid currently offers. */
const CALENDAR_STEPS: Record<string, ((day: Date) => Date) | undefined> = {
  ArrowLeft: (day) => addDays(day, -1),
  ArrowRight: (day) => addDays(day, 1),
  ArrowUp: (day) => addDays(day, -WEEKDAY_LABELS.length),
  ArrowDown: (day) => addDays(day, WEEKDAY_LABELS.length),
  Home: (day) => addDays(day, -((day.getDay() + 6) % WEEKDAY_LABELS.length)),
  End: (day) =>
    addDays(day, WEEKDAY_LABELS.length - 1 - ((day.getDay() + 6) % WEEKDAY_LABELS.length)),
  PageUp: (day) => addMonths(day, -1),
  PageDown: (day) => addMonths(day, 1),
};

function dayClassName(day: Date, selected: Date | null, today: Date): string {
  const classNames = ['calendar__day'];

  if (selected !== null && isSameDay(day, selected)) {
    classNames.push('calendar__day--selected');
  } else if (isSameDay(day, today)) {
    classNames.push('calendar__day--today');
  }

  return classNames.join(' ');
}
