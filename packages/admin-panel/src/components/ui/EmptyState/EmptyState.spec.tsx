import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it.each(['empty', 'noMatch'] as const)('is a status for kind %s', (kind) => {
    render(<EmptyState kind={kind} title="Nothing here" />);

    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
  });

  it('defaults to kind empty', () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it.each(['empty', 'noMatch'] as const)('hides the %s icon from assistive tech', (kind) => {
    const { container } = render(<EmptyState kind={kind} title="Nothing here" />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a different icon for noMatch than for empty', () => {
    const empty = render(<EmptyState kind="empty" title="a" />);
    const emptyIcon = empty.container.querySelector('svg')?.innerHTML;
    cleanup();
    const noMatch = render(<EmptyState kind="noMatch" title="a" />);

    expect(noMatch.container.querySelector('svg')?.innerHTML).not.toBe(emptyIcon);
  });

  it('renders the title as an h2 in the page layout', () => {
    render(<EmptyState title="Nothing here" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeInTheDocument();
  });

  it('renders the title as an h3 in the section layout', () => {
    render(<EmptyState layout="section" title="Nothing here" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument();
  });

  it('centres the page layout and keeps the section layout in the flow', () => {
    const { rerender } = render(<EmptyState title="Nothing here" />);

    expect(screen.getByRole('status')).toHaveClass('flex-1', 'items-center', 'justify-center');

    rerender(<EmptyState layout="section" title="Nothing here" />);

    expect(screen.getByRole('status')).not.toHaveClass('flex-1', 'justify-center');
  });

  it('renders the body and actions only when given', () => {
    const { rerender } = render(<EmptyState title="Nothing here" />);

    expect(screen.queryByText('Start one.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <EmptyState
        title="Nothing here"
        body="Start one."
        actions={<button type="button">Go</button>}
      />,
    );

    expect(screen.getByText('Start one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('forwards a className to the root', () => {
    render(<EmptyState title="Nothing here" className="my-4" />);

    expect(screen.getByRole('status')).toHaveClass('my-4');
  });
});
