import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DecisionBanner } from './DecisionBanner';

describe('DecisionBanner', () => {
  it.each([
    ['approved', 'Approved', 965, 'approved'],
    ['review', 'Under review', 598, 'review'],
    ['declined', 'Declined', 362, 'declined'],
  ] as const)('renders %s with its label, score and band', (decision, label, score, band) => {
    render(<DecisionBanner decision={decision} score={score} band={band} />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(String(score))).toBeInTheDocument();
    expect(screen.getByText(band)).toBeInTheDocument();
  });

  it('shows n/a when the report carries no score', () => {
    render(<DecisionBanner decision="review" />);

    expect(screen.getAllByText('n/a')).toHaveLength(2);
  });
});
