import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BAND_COLORS, ScoreGauge } from './ScoreGauge';

describe('ScoreGauge', () => {
  afterEach(cleanup);

  it.each([
    [399, 'decline', 'Decline'],
    [400, 'review', 'Review'],
    [699, 'review', 'Review'],
    [700, 'approve', 'Approve'],
  ] as const)('colours %i as %s', (score, band, label) => {
    render(<ScoreGauge score={score} />);

    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-band', band);
    expect(screen.getByTestId('score-gauge-band')).toHaveTextContent(label);
    expect(screen.getByTestId('score-gauge-fill')).toHaveAttribute('stroke', BAND_COLORS[band]);
    expect(screen.getByText(String(score))).toBeInTheDocument();
  });

  it('takes the band from creditScoreBand when given', () => {
    render(<ScoreGauge score={900} band="review" />);

    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-band', 'review');
  });
});
