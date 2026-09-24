import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '@/lib/format-date-time';
import type { OnboardingTransition } from '@/api/onboardings/onboarding-transitions';
import { OnboardingPathStrip } from './OnboardingPathStrip';

afterEach(() => {
  cleanup();
});

function buildTransition(overrides: Partial<OnboardingTransition>): OnboardingTransition {
  return {
    id: 'transition-1',
    occurredAt: '2026-08-31T09:14:00.000Z',
    status: 'awaiting_user',
    fromStep: null,
    appliedStep: null,
    enteredStep: 'collect_contact',
    trigger: null,
    current: false,
    ...overrides,
  };
}

describe('OnboardingPathStrip', () => {
  it('renders one list item per transition, in travel order', () => {
    const transitions = [
      buildTransition({ id: 't1', enteredStep: 'collect_contact' }),
      buildTransition({ id: 't2', enteredStep: 'collect_personal' }),
      buildTransition({
        id: 't3',
        enteredStep: 'manual_review',
        current: true,
        occurredAt: '2026-09-02T11:48:00.000Z',
      }),
    ];

    render(<OnboardingPathStrip transitions={transitions} truncated={false} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('collect_contact'),
      expect.stringContaining('collect_personal'),
      expect.stringContaining('manual_review'),
    ]);
  });

  it('marks the current step with "Here since" text instead of a bare timestamp', () => {
    const transitions = [
      buildTransition({ id: 't1', enteredStep: 'collect_contact' }),
      buildTransition({
        id: 't2',
        enteredStep: 'manual_review',
        current: true,
        occurredAt: '2026-09-02T11:48:00.000Z',
      }),
    ];

    render(<OnboardingPathStrip transitions={transitions} truncated={false} />);

    const occurredAt = formatDateTime('2026-09-02T11:48:00.000Z');
    expect(screen.getByText(`Here since ${occurredAt}`)).toBeInTheDocument();
    expect(screen.queryByText(occurredAt)).not.toBeInTheDocument();
  });

  it('labels a step card by the step the transition entered', () => {
    render(
      <OnboardingPathStrip
        transitions={[buildTransition({ id: 't1', enteredStep: 'review-documents' })]}
        truncated={false}
      />,
    );

    expect(screen.getByText('review-documents')).toBeInTheDocument();
  });

  it('labels a step card that entered no step by the status it reached', () => {
    render(
      <OnboardingPathStrip
        transitions={[buildTransition({ id: 't1', enteredStep: null, status: 'approved' })]}
        truncated={false}
      />,
    );

    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('labels a step card by a status the panel does not recognize as it arrived', () => {
    render(
      <OnboardingPathStrip
        transitions={[buildTransition({ id: 't1', enteredStep: null, status: 'quarantined' })]}
        truncated={false}
      />,
    );

    expect(screen.getByText('quarantined')).toBeInTheDocument();
  });

  it('renders a single line of text instead of an empty scroller when there are no transitions', () => {
    render(<OnboardingPathStrip transitions={[]} truncated={false} />);

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No steps recorded yet.')).toBeInTheDocument();
  });

  it('names the scroller it makes keyboard reachable, so the focus stop is announced', () => {
    render(<OnboardingPathStrip transitions={[buildTransition({ id: 't1' })]} truncated={false} />);

    const scroller = screen.getByRole('region', { name: 'Path taken' });

    expect(scroller).toHaveAttribute('tabindex', '0');
  });

  it('shows the step count as the section meta', () => {
    render(
      <OnboardingPathStrip
        transitions={[buildTransition({ id: 't1' }), buildTransition({ id: 't2' })]}
        truncated={false}
      />,
    );

    expect(screen.getByText('2 steps')).toBeInTheDocument();
  });

  it('says the chain starts mid-journey when the endpoint reported only part of the trail', () => {
    render(
      <OnboardingPathStrip
        transitions={[buildTransition({ id: 't1' }), buildTransition({ id: 't2' })]}
        truncated
      />,
    );

    // The caveat belongs to the band that drew the steps, not to the page's status line.
    expect(screen.getByText('2 most recent steps · earlier steps not shown')).toBeInTheDocument();
  });
});
