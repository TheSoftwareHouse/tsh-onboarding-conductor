/**
 * A time window stated as a relative period rather than as an instant.
 *
 * The period is what gets committed and shared, and it is resolved to an instant only when a
 * request is built. `Last hour` therefore names the hour ending now however long ago the criterion
 * was set, instead of freezing its near end at the minute it was chosen and growing from there.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

/** Rolling spans the two longest periods cover, counted in days rather than by the calendar. */
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;

/** Periods offered, written `<number><unit>` as Sentry writes `statsPeriod`. */
export const DATE_TIME_PERIODS = ['1h', '24h', '7d', '30d'] as const;

export type DateTimePeriod = (typeof DATE_TIME_PERIODS)[number];

/** The window is two absolute bounds instead of a period, which is the one case that carries dates. */
export const CUSTOM_PERIOD = 'custom';

/** A period, `custom` for an absolute window, or '' for no window at all ("All time"). */
export type DateTimeRangePeriod = '' | DateTimePeriod | typeof CUSTOM_PERIOD;

/** How far back each period opens, which is what a request resolves it through. */
const PERIOD_MINUTES: Record<DateTimePeriod, number> = {
  '1h': MINUTES_PER_HOUR,
  '24h': MINUTES_PER_DAY,
  '7d': DAYS_IN_WEEK * MINUTES_PER_DAY,
  '30d': DAYS_IN_MONTH * MINUTES_PER_DAY,
};

const PERIOD_LABELS: Record<DateTimePeriod, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** Whether this build offers the period, narrowing the string the caller already holds. */
export function isDateTimePeriod(value: string): value is DateTimePeriod {
  return (DATE_TIME_PERIODS as readonly string[]).includes(value);
}

/** How the period reads in the control that offers it. */
export function describeDateTimePeriod(period: DateTimePeriod): string {
  return PERIOD_LABELS[period];
}

/**
 * The instant a period opens at, measured from now. Called when a request is built rather than
 * when the criterion is committed, which is what keeps the window sliding.
 */
export function periodStartInstant(period: DateTimePeriod, now: Date = new Date()): string {
  return new Date(now.getTime() - PERIOD_MINUTES[period] * MILLISECONDS_PER_MINUTE).toISOString();
}
