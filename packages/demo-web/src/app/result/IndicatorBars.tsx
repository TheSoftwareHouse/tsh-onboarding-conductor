import { NotComputed } from './NotComputed';
import { INDICATOR_LIMIT, type Indicator } from './report-selectors';

const HALF = 50;
const NEGATIVE = '#d92d20';
const POSITIVE = '#1a8f4c';

function IndicatorBar({ indicator }: { indicator: Indicator }) {
  const { label, value } = indicator;
  const clamped = value === null ? 0 : Math.min(Math.max(value, -INDICATOR_LIMIT), INDICATOR_LIMIT);
  const width = (Math.abs(clamped) / INDICATOR_LIMIT) * HALF;

  return (
    <li className="grid gap-1" data-testid={`indicator-${indicator.key}`}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-card-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value === null ? 'Not computed' : value > 0 ? `+${value}` : value}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={-INDICATOR_LIMIT}
        aria-valuemax={INDICATOR_LIMIT}
        aria-valuenow={value ?? undefined}
        className="relative h-3 rounded-full bg-secondary"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
        {value !== null && value !== 0 && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full"
            style={{
              width: `${width}%`,
              left: value < 0 ? `${HALF - width}%` : `${HALF}%`,
              backgroundColor: value < 0 ? NEGATIVE : POSITIVE,
            }}
          />
        )}
      </div>
    </li>
  );
}

/** Three horizontal bars on a -5..+5 scale; negative extends left, positive right. */
export function IndicatorBars({ indicators }: { indicators: Indicator[] }) {
  if (indicators.every((indicator) => indicator.value === null)) {
    return <NotComputed what="credit indicators" />;
  }
  return (
    <ul className="grid gap-4">
      {indicators.map((indicator) => (
        <IndicatorBar key={indicator.key} indicator={indicator} />
      ))}
      <li className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{-INDICATOR_LIMIT}</span>
        <span>0</span>
        <span>+{INDICATOR_LIMIT}</span>
      </li>
    </ul>
  );
}
