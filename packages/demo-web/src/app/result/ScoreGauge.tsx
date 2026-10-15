import { type Band, SCORE_MAX, bandForScore } from './report-selectors';

export const BAND_COLORS: Record<Band, string> = {
  decline: '#d92d20',
  review: '#e08a00',
  approve: '#1a8f4c',
};

const BAND_LABELS: Record<Band, string> = {
  decline: 'Decline',
  review: 'Review',
  approve: 'Approve',
};

const ARC_PATH = 'M 20 100 A 80 80 0 0 1 180 100';
const STROKE_WIDTH = 16;

/** Semicircle gauge, 0-1000; fill and band label are coloured by band. */
export function ScoreGauge({ score, band }: { score: number; band?: Band }) {
  const resolved = band ?? bandForScore(score);
  const clamped = Math.min(Math.max(score, 0), SCORE_MAX);
  const color = BAND_COLORS[resolved];

  return (
    <figure
      className="flex flex-col items-center gap-2"
      data-testid="score-gauge"
      data-band={resolved}
      aria-label={`Credit score ${score} of ${SCORE_MAX}, band ${BAND_LABELS[resolved]}`}
    >
      <svg viewBox="0 0 200 120" className="w-full max-w-xs" role="img" aria-hidden="true">
        <path
          d={ARC_PATH}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          pathLength={SCORE_MAX}
        />
        <path
          data-testid="score-gauge-fill"
          d={ARC_PATH}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          pathLength={SCORE_MAX}
          strokeDasharray={`${clamped} ${SCORE_MAX}`}
        />
        <text x="100" y="92" textAnchor="middle" fontSize="34" fontWeight="600" fill="currentColor">
          {score}
        </text>
        <text x="20" y="118" textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">
          0
        </text>
        <text x="180" y="118" textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">
          {SCORE_MAX}
        </text>
      </svg>
      <figcaption className="flex items-center gap-2 text-sm font-medium">
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span data-testid="score-gauge-band">{BAND_LABELS[resolved]}</span>
      </figcaption>
    </figure>
  );
}
