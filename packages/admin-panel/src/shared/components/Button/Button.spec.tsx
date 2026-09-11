import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('defaults to a non-submitting button, so one inside a form does not submit it by accident', () => {
    render(<Button>Reload</Button>);

    expect(screen.getByRole('button', { name: 'Reload' })).toHaveAttribute('type', 'button');
  });

  it.each([
    ['primary', 'bg-tsh-black'],
    ['secondary', 'border-border-strong'],
    ['outline', 'border-tsh-black'],
    ['quiet', 'text-fg-3'],
  ] as const)('renders the %s treatment', (variant, expected) => {
    render(<Button variant={variant}>Export</Button>);

    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it.each([
    ['sm', 'h-7'],
    ['md', 'h-8'],
    ['lg', 'h-10'],
  ] as const)('renders %s at its design height', (size, expected) => {
    render(<Button size={size}>Test all</Button>);

    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it.each([
    ['primary', 'lg', 'px-6'],
    ['secondary', 'lg', 'px-4'],
    ['secondary', 'md', 'px-3'],
    ['secondary', 'sm', 'px-2.5'],
    ['quiet', 'lg', 'px-3'],
  ] as const)('pads %s at %s exactly once', (variant, size, expected) => {
    render(
      <Button variant={variant} size={size}>
        Reset
      </Button>,
    );

    const padding = Array.from(screen.getByRole('button').classList).filter((name) =>
      name.startsWith('px-'),
    );

    expect(padding).toEqual([expected]);
  });

  it('appends a caller class rather than replacing its own', () => {
    render(<Button className="ml-auto">Next</Button>);

    const button = screen.getByRole('button');

    expect(button).toHaveClass('ml-auto');
    expect(button).toHaveClass('h-10');
  });

  it('forwards the click', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ['primary', 'enabled:hover:bg-tsh-ink-1'],
    ['secondary', 'enabled:hover:bg-tsh-black'],
    ['outline', 'enabled:hover:bg-tsh-black'],
  ] as const)('hovers %s the way the design system specifies', (variant, expected) => {
    render(<Button variant={variant}>Get in touch</Button>);

    expect(screen.getByRole('button')).toHaveClass(expected);
  });

  it.each([
    ['primary', 'disabled:bg-fg-disabled'],
    ['secondary', 'disabled:text-fg-disabled'],
    ['outline', 'disabled:text-fg-disabled'],
    ['quiet', 'disabled:text-fg-disabled'],
  ] as const)('dims %s with the disabled token rather than opacity', (variant, expected) => {
    render(
      <Button variant={variant} disabled>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');

    expect(button).toHaveClass(expected);
    expect(button).not.toHaveClass('disabled:opacity-60');
  });

  it('transitions on the design system motion tokens', () => {
    render(<Button>Reload</Button>);

    expect(screen.getByRole('button')).toHaveClass(
      'transition-colors',
      'duration-base',
      'ease-default',
    );
  });
});
