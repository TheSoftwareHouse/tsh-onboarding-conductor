import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Typography, type TypographyVariant } from './Typography';

afterEach(() => {
  cleanup();
});

describe('Typography', () => {
  it('defaults to body-md on a paragraph', () => {
    render(<Typography>Onboarding details</Typography>);

    const text = screen.getByText('Onboarding details');

    expect(text.tagName).toBe('P');
    expect(text).toHaveClass('font-body', 'text-body-md', 'text-fg-2');
  });

  it.each([
    ['h1', 'H1'],
    ['h4', 'H4'],
    ['body-sm', 'P'],
    ['caption', 'P'],
    ['caps-tiny', 'SPAN'],
    ['mono', 'SPAN'],
  ] as [TypographyVariant, string][])('renders %s on a %s', (variant, tag) => {
    render(<Typography variant={variant}>Workflow</Typography>);

    expect(screen.getByText('Workflow').tagName).toBe(tag);
  });

  it('renders headings in the display face and body in the body face', () => {
    render(
      <>
        <Typography variant="h3">Heading</Typography>
        <Typography variant="body-sm">Body</Typography>
      </>,
    );

    expect(screen.getByText('Heading')).toHaveClass('font-display', 'text-h3', 'text-fg-1');
    expect(screen.getByText('Body')).toHaveClass('font-body', 'text-body-sm', 'text-fg-3');
  });

  it('uppercases every caps variant', () => {
    render(
      <>
        <Typography variant="caps-bigger">Big</Typography>
        <Typography variant="caps-tiny">Tiny</Typography>
      </>,
    );

    expect(screen.getByText('Big')).toHaveClass('uppercase', 'text-fg-1');
    expect(screen.getByText('Tiny')).toHaveClass('uppercase', 'text-fg-2');
  });

  it('takes a different element without losing the style', () => {
    render(
      <dl>
        <Typography variant="caps-tiny" as="dt">
          Workflow ID
        </Typography>
      </dl>,
    );

    const label = screen.getByText('Workflow ID');

    expect(label.tagName).toBe('DT');
    expect(label).toHaveClass('text-caps-tiny');
  });

  it('renders the meta variant as the caps-tiny size without uppercase', () => {
    render(<Typography variant="meta">Updated by Jan</Typography>);

    const text = screen.getByText('Updated by Jan');

    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveClass('font-body', 'text-caps-tiny');
    expect(text).not.toHaveClass('uppercase', 'tracking-caps');
  });

  it('keeps caps-tiny uppercase alongside the new non-uppercase meta variant', () => {
    render(
      <>
        <Typography variant="caps-tiny">Loud</Typography>
        <Typography variant="meta">Quiet</Typography>
      </>,
    );

    expect(screen.getByText('Loud')).toHaveClass('uppercase');
    expect(screen.getByText('Quiet')).not.toHaveClass('uppercase');
  });

  it('accepts a label element and its own htmlFor prop', () => {
    render(
      <Typography variant="caps-tiny" as="label" htmlFor="some-id">
        Field label
      </Typography>,
    );

    const label = screen.getByText('Field label');

    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'some-id');
  });

  it.each([
    ['h1', 'H1'],
    ['h2', 'H2'],
    ['h3', 'H3'],
    ['h4', 'H4'],
    ['h5', 'H5'],
    ['h6', 'H6'],
    ['body-lg', 'P'],
    ['body-md', 'P'],
    ['body-sm', 'P'],
    ['caption', 'P'],
    ['caps-bigger', 'SPAN'],
    ['caps-medium', 'SPAN'],
    ['caps-regular', 'SPAN'],
    ['caps-small', 'SPAN'],
    ['caps-tiny', 'SPAN'],
    ['meta', 'SPAN'],
    ['mono', 'SPAN'],
  ] as [TypographyVariant, string][])('defaults %s to a %s element', (variant, tag) => {
    render(<Typography variant={variant}>Default element</Typography>);

    expect(screen.getByText('Default element').tagName).toBe(tag);
  });
});
