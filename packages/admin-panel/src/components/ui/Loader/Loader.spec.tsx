import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Loader } from './Loader';

afterEach(() => {
  cleanup();
});

describe('Loader', () => {
  it.each(['block', 'inline'] as const)('announces the label once as a status in %s', (layout) => {
    render(<Loader label="Loading onboardings…" layout={layout} />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings…');
  });

  it('defaults to the block layout, with the label visible to screen readers only', () => {
    render(<Loader label="Loading workflows…" />);

    expect(screen.getByText('Loading workflows…')).toHaveClass('sr-only');
  });

  it('shows the label in the inline layout', () => {
    render(<Loader label="Loading activity…" layout="inline" />);

    expect(screen.getByText('Loading activity…')).not.toHaveClass('sr-only');
  });

  it.each(['block', 'inline'] as const)(
    'hides the spinner icon from assistive tech in %s',
    (layout) => {
      const { container } = render(<Loader label="Loading…" layout={layout} />);

      const icon = container.querySelector('svg');

      expect(icon).toHaveAttribute('aria-hidden', 'true');
    },
  );

  it('centres the block layout in its container', () => {
    render(<Loader label="Loading connectors…" />);

    expect(screen.getByRole('status')).toHaveClass(
      'flex',
      'flex-1',
      'flex-col',
      'items-center',
      'justify-center',
      'min-h-60',
    );
  });

  it('leaves the inline layout in the flow', () => {
    render(<Loader label="Loading activity…" layout="inline" />);

    expect(screen.getByRole('status')).not.toHaveClass('justify-center', 'flex-1');
  });

  it('forwards a className to the root', () => {
    render(<Loader label="Loading…" className="my-4" />);

    expect(screen.getByRole('status')).toHaveClass('my-4');
  });
});
