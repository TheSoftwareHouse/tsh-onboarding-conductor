import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorState } from './ErrorState';

afterEach(() => {
  cleanup();
});

describe('ErrorState', () => {
  it.each([
    ['error', 'alert'],
    ['denied', 'alert'],
    ['notFound', 'status'],
  ] as const)('kind %s has role %s', (kind, role) => {
    render(<ErrorState kind={kind} title="Unable to load" />);

    expect(screen.getByRole(role)).toHaveTextContent('Unable to load');
  });

  it('defaults to kind error', () => {
    render(<ErrorState title="Unable to load" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it.each(['error', 'notFound', 'denied'] as const)(
    'hides the %s icon from assistive tech',
    (kind) => {
      const { container } = render(<ErrorState kind={kind} title="Unable to load" />);

      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    },
  );

  it('colours the error icon red and the others neutral', () => {
    const error = render(<ErrorState kind="error" title="a" />);

    expect(error.container.querySelector('svg')).toHaveClass('text-tsh-red');
    cleanup();
    const denied = render(<ErrorState kind="denied" title="a" />);

    expect(denied.container.querySelector('svg')).toHaveClass('text-fg-1');
  });

  it('renders the title as an h2 in the page layout', () => {
    render(<ErrorState title="Unable to load" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load' })).toBeInTheDocument();
  });

  it('renders the title as an h3 in the section layout', () => {
    render(<ErrorState layout="section" title="Unable to load" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Unable to load' })).toBeInTheDocument();
  });

  it('renders the body and actions only when given', () => {
    const { rerender } = render(<ErrorState title="Unable to load" />);

    expect(screen.queryByText('Request failed.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <ErrorState
        title="Unable to load"
        body="Request failed."
        actions={<button type="button">Retry</button>}
      />,
    );

    expect(screen.getByText('Request failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('forwards a className to the root', () => {
    render(<ErrorState title="Unable to load" className="my-4" />);

    expect(screen.getByRole('alert')).toHaveClass('my-4');
  });
});
