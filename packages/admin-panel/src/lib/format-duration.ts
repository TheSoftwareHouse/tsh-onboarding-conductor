import { NOT_SET } from './format-date-time';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
const MAX_UNITS_SHOWN = 2;

interface DurationUnit {
  amount: number;
  suffix: string;
}

/** The run-meta band's compact span: largest two non-zero units among days/hours/minutes, e.g. `3 d 2 h`. */
export function formatDuration(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NOT_SET;
  }

  const totalMinutes = Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE);
  if (totalMinutes < 1) {
    return '< 1 m';
  }

  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  const units: DurationUnit[] = [
    { amount: days, suffix: 'd' },
    { amount: hours, suffix: 'h' },
    { amount: minutes, suffix: 'm' },
  ].filter((unit) => unit.amount > 0);

  return units
    .slice(0, MAX_UNITS_SHOWN)
    .map((unit) => `${unit.amount} ${unit.suffix}`)
    .join(' ');
}
