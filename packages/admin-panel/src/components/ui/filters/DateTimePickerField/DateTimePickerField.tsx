import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { input } from '@/components/ui/Input/Input';
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
} from '@/lib/calendar-month';
import { cn } from '@/lib/cn';
import {
  parseDateTimeLocalValue,
  timeOfDayFromValue,
  toDateTimeLocalValue,
  toDateTimeLocalValueParts,
} from '@/lib/datetime-local';
import { formatDateTime } from '@/lib/format-date-time';
import { tv } from '@/lib/tv';
import { FilterField, type FilterControlProps } from '../FilterField';

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
      <div className="relative min-w-0" ref={containerRef}>
        <input
          id={id}
          name={name}
          ref={controlRef}
          type="text"
          className={input({ className: 'cursor-pointer placeholder:text-fg-4' })}
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
            className={cn(
              'absolute top-full z-10 mt-1 flex flex-col gap-2 border border-border-hair bg-bg-page p-2.5',
              alignToEnd ? 'right-0' : 'left-0',
            )}
            role="dialog"
            aria-label={`${label}: choose a date and time`}
            onKeyDown={handleCalendarKeyDown}
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className={calendarStep()}
                aria-label="Previous month"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              >
                ‹
              </button>
              <span className="text-body-sm font-medium text-fg-1" aria-live="polite">
                {formatMonthTitle(viewMonth)}
              </span>
              <button
                type="button"
                className={calendarStep()}
                aria-label="Next month"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-[repeat(7,2rem)] gap-0.5">
              {WEEKDAY_LABELS.map((weekday) => (
                <span
                  key={weekday}
                  className="text-center text-caps-tiny text-fg-3"
                  aria-hidden="true"
                >
                  {weekday.slice(0, 2)}
                </span>
              ))}
              {days.map((day, cell) =>
                day === null ? (
                  // A blank cell has no identity beyond its place in the grid.
                  <span key={`blank-${cell}`} className="invisible" />
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
            <div className="flex items-center justify-between gap-2 border-t border-border-hair pt-2">
              <label htmlFor={`${id}-time`} className="text-body-sm font-medium text-fg-3">
                Time
              </label>
              <input
                id={`${id}-time`}
                type="time"
                className="h-8 border border-border-hair bg-bg-page px-2 text-body-sm text-fg-1 enabled:hover:border-border-strong"
                value={timeOfDayFromValue(value, '')}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  selectTimeOfDay(event.target.value)
                }
              />
            </div>
            <div className="flex gap-1.5">
              <Button type="button" variant="secondary" size="sm" onClick={selectNow}>
                Now
              </Button>
              <Button type="button" variant="quiet" size="sm" onClick={clear}>
                Clear
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="ml-auto"
                onClick={closeCalendar}
              >
                Done
              </Button>
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

/** The month-step arrows either side of the calendar's header. */
const calendarStep = tv({
  base: 'flex size-7 cursor-pointer items-center justify-center border border-transparent text-body-md leading-none text-fg-3 enabled:hover:bg-bg-alt enabled:hover:text-fg-2',
});

/** One day cell in the grid: bordered when it's today, filled when it's the chosen bound. */
const calendarDay = tv({
  base: 'flex size-8 cursor-pointer items-center justify-center border border-transparent text-body-sm font-medium text-fg-1 enabled:hover:bg-bg-alt enabled:hover:text-fg-2',
  variants: {
    tone: {
      default: '',
      today: 'border-border-strong',
      selected:
        'border-tsh-black bg-tsh-black text-tsh-white enabled:hover:border-tsh-gray-700 enabled:hover:bg-tsh-gray-700 enabled:hover:text-tsh-white',
    },
  },
  defaultVariants: { tone: 'default' },
});

function dayClassName(day: Date, selected: Date | null, today: Date): string {
  if (selected !== null && isSameDay(day, selected)) {
    return calendarDay({ tone: 'selected' });
  }

  if (isSameDay(day, today)) {
    return calendarDay({ tone: 'today' });
  }

  return calendarDay();
}
