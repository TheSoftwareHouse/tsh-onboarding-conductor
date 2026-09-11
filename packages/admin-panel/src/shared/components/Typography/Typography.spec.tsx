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
});
