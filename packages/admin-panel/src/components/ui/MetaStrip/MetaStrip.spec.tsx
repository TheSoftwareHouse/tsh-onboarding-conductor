import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MetaStrip, MetaStripItem } from './MetaStrip';

afterEach(() => {
  cleanup();
});

describe('MetaStrip', () => {
  it('renders each item label and value', () => {
    render(
      <MetaStrip>
        <MetaStripItem label="Started" value="31 Aug, 09:14" />
        <MetaStripItem label="Total" value="3 d 2 h" />
      </MetaStrip>,
    );

    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('31 Aug, 09:14')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('3 d 2 h')).toBeInTheDocument();
  });

  it('places a divider only between items, never leading or trailing', () => {
    const { container } = render(
      <MetaStrip>
        <MetaStripItem label="Started" value="31 Aug, 09:14" />
        <MetaStripItem label="Last update" value="2 Sep, 11:48" />
        <MetaStripItem label="Total" value="3 d 2 h" />
      </MetaStrip>,
    );

    const dividers = container.querySelectorAll('[aria-hidden="true"]');
    expect(dividers).toHaveLength(2);
  });

  it('hides dividers from assistive technology', () => {
    const { container } = render(
      <MetaStrip>
        <MetaStripItem label="Started" value="31 Aug, 09:14" />
        <MetaStripItem label="Total" value="3 d 2 h" />
      </MetaStrip>,
    );

    const divider = container.querySelector('[aria-hidden="true"]');
    expect(divider).not.toBeNull();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('distinguishes the highlighted value with the amber treatment', () => {
    render(
      <MetaStrip>
        <MetaStripItem label="In manual_review" value="2 d 4 h" highlighted />
        <MetaStripItem label="Total" value="3 d 2 h" />
      </MetaStrip>,
    );

    expect(screen.getByText('2 d 4 h')).toHaveClass('bg-tsh-yellow-400');
    expect(screen.getByText('3 d 2 h')).not.toHaveClass('bg-tsh-yellow-400');
  });
});
