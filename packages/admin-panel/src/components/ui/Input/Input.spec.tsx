import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from './Input';

afterEach(() => {
  cleanup();
});

/** The exact class set the panel's pre-extraction filter control produced — order-independent. */
const DEFAULT_CLASSES = [
  'h-10',
  'w-full',
  'rounded-none',
  'border',
  'border-border-strong',
  'bg-bg-page',
  'px-3',
  'text-body-sm',
  'text-fg-1',
  'enabled:hover:border-tsh-black',
  'disabled:text-fg-disabled',
  'aria-invalid:border-tsh-red',
];

describe('Input', () => {
  it('defaults to exactly the class set the pre-extraction filter control produced', () => {
    render(<Input aria-label="Setting" />);

    const control = screen.getByLabelText('Setting');
    expect(control.className.split(' ').sort()).toEqual([...DEFAULT_CLASSES].sort());
    expect(control).not.toHaveClass('font-mono', 'text-mono', 'h-9');
  });

  it("swaps the mono font for the design's settings box", () => {
    render(<Input aria-label="Setting" font="mono" />);

    const control = screen.getByLabelText('Setting');
    expect(control).toHaveClass('font-mono', 'text-mono');
    expect(control).not.toHaveClass('text-body-sm');
  });

  it("swaps the sm size for `Pagination`'s page box", () => {
    render(<Input aria-label="Setting" size="sm" />);

    const control = screen.getByLabelText('Setting');
    expect(control).toHaveClass('h-9');
    expect(control).not.toHaveClass('h-10');
  });

  it("forwards a ref to the DOM node, which `react-hook-form`'s `register` relies on", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="Setting" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(screen.getByLabelText('Setting'));
  });

  it('passes `aria-invalid` through to the control', () => {
    render(<Input aria-label="Setting" aria-invalid />);

    expect(screen.getByLabelText('Setting')).toHaveAttribute('aria-invalid', 'true');
  });
});
