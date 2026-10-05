import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { TextLink } from './TextLink';

afterEach(() => {
  cleanup();
});

function renderLink(ui: ReactElement): void {
  render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('TextLink', () => {
  it('renders an underlined link to the target, in body-sm by default', () => {
    renderLink(<TextLink to="/onboardings?workflowId=kyc">View onboardings</TextLink>);

    const link = screen.getByRole('link', { name: 'View onboardings' });
    expect(link).toHaveAttribute('href', '/onboardings?workflowId=kyc');
    expect(link).toHaveClass('text-body-sm', 'text-fg-1', 'underline', 'decoration-border-strong');
  });

  it('renders the mono variant in the link colour, not the variant’s own', () => {
    renderLink(
      <TextLink to="/onboardings" variant="mono">
        12
      </TextLink>,
    );

    const link = screen.getByRole('link', { name: '12' });
    expect(link).toHaveClass('font-mono', 'text-mono', 'text-fg-1');
    expect(link).not.toHaveClass('text-fg-2');
  });

  it('merges a caller’s layout class and passes link props through', () => {
    renderLink(
      <TextLink to="/workflows" className="self-start" title="Open">
        Workflows
      </TextLink>,
    );

    const link = screen.getByRole('link', { name: 'Workflows' });
    expect(link).toHaveClass('self-start');
    expect(link).toHaveAttribute('title', 'Open');
  });
});
