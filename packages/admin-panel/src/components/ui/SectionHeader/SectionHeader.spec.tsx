import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SectionHeader } from './SectionHeader';

afterEach(() => {
  cleanup();
});

describe('SectionHeader', () => {
  it('titles the band with a level-2 heading', () => {
    render(<SectionHeader title="Scores" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Scores' })).toBeInTheDocument();
  });

  it('renders no meta text and no trailing slot when neither is given', () => {
    render(<SectionHeader title="Scores" />);

    expect(screen.queryByText(/entries|Declared by/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the meta text beside the title', () => {
    render(<SectionHeader title="Activity log" meta="6 of 24 entries" />);

    expect(screen.getByText('6 of 24 entries')).toBeInTheDocument();
  });

  it('renders a trailing slot pushed to the far edge', () => {
    render(<SectionHeader title="Scores" trailing={<a href="/audit">See in Logs</a>} />);

    expect(screen.getByRole('link', { name: 'See in Logs' })).toBeInTheDocument();
  });

  it('keeps the accessible name of the heading to the title alone', () => {
    render(
      <SectionHeader
        title="Activity log"
        meta="6 of 24 entries"
        trailing={<a href="/audit">See in Logs</a>}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Activity log' })).toBeInTheDocument();
  });
});
