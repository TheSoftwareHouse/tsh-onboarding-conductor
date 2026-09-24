import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip, type ChipTone } from './Chip';

afterEach(() => {
  cleanup();
});

describe('Chip', () => {
  it('defaults to the neutral tone, the design system tag', () => {
    render(<Chip>Published</Chip>);

    expect(screen.getByText('Published')).toHaveClass('bg-bg-alt', 'text-fg-2');
  });

  it.each([
    ['strong', 'bg-tsh-black'],
    ['outline', 'text-fg-3'],
    ['muted', 'text-fg-4'],
    ['attention', 'bg-tsh-yellow-200'],
    ['active', 'bg-tsh-yellow-400'],
    ['info', 'bg-tsh-blue-100'],
    ['scheduled', 'bg-tsh-purple-300'],
    ['danger', 'border-tsh-red'],
  ] as [ChipTone, string][])('renders the %s tone', (tone, expected) => {
    render(<Chip tone={tone}>Review</Chip>);

    expect(screen.getByText('Review')).toHaveClass(expected);
  });

  it('grows rather than clips, so a chip carrying a date can wrap', () => {
    render(<Chip>2026-01-15 · outdated</Chip>);

    const chip = screen.getByText('2026-01-15 · outdated');

    expect(chip).toHaveClass('min-h-6');
    expect(chip).not.toHaveClass('h-6');
  });

  it('pads vertically as well as horizontally, so a wrapped line is not flush to the edge', () => {
    render(<Chip>Awaiting manual review</Chip>);

    expect(screen.getByText('Awaiting manual review')).toHaveClass('px-2.5', 'py-1');
  });

  it('applies the caps treatment every tone shares', () => {
    render(<Chip tone="danger">Unconfigured</Chip>);

    expect(screen.getByText('Unconfigured')).toHaveClass(
      'text-body-2xs',
      'tracking-caps',
      'uppercase',
    );
  });

  it("defaults to the badge size, today's exact classes, so existing call sites are unchanged", () => {
    render(<Chip>Published</Chip>);

    const badge = screen.getByText('Published');

    expect(badge).toHaveClass('min-h-6', 'px-2.5', 'py-1', 'text-body-2xs');
    expect(badge).not.toHaveClass('px-2', 'py-0.75', 'text-caps-tiny');
  });

  it("renders the status size as the card pill's 12px, tighter padding", () => {
    render(
      <Chip tone="strong" size="status">
        Configured
      </Chip>,
    );

    const pill = screen.getByText('Configured');

    expect(pill).toHaveClass('px-2', 'py-0.75', 'text-caps-tiny', 'uppercase');
    expect(pill).not.toHaveClass('min-h-6', 'px-2.5', 'py-1', 'text-body-2xs');
  });
});
