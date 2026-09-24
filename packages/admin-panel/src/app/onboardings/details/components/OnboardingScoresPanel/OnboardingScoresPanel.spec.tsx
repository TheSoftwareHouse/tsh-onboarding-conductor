import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OnboardingScoreView } from '../../hooks/useAdminOnboardingDetails';
import { OnboardingScoresPanel } from './OnboardingScoresPanel';

afterEach(() => {
  cleanup();
});

const BOUNDED: OnboardingScoreView = { name: 'risk', value: 42, bounds: { min: 0, max: 100 } };
const UNBOUNDED: OnboardingScoreView = { name: 'trust', value: 7, bounds: null };

describe('OnboardingScoresPanel', () => {
  it('titles the band and names the declaring workflow', () => {
    render(<OnboardingScoresPanel scores={[BOUNDED]} workflowId="scoring" workflowVersion={1} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Scores' })).toBeInTheDocument();
    expect(screen.getByText(/Declared by/)).toBeInTheDocument();
    expect(screen.getByText('scoring v1')).toBeInTheDocument();
  });

  it('renders a bounded score as value/max', () => {
    render(<OnboardingScoresPanel scores={[BOUNDED]} workflowId="scoring" workflowVersion={1} />);

    expect(screen.getByText('risk')).toBeInTheDocument();
    expect(screen.getByText('42/100')).toBeInTheDocument();
  });

  it('renders an unbounded score as the bare value', () => {
    render(<OnboardingScoresPanel scores={[UNBOUNDED]} workflowId="scoring" workflowVersion={1} />);

    expect(screen.getByText('trust')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
