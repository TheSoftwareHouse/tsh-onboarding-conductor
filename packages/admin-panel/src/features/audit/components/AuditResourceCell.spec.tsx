import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOnboardingDetailsPath } from '@/features/onboarding/constants/routes';
import { AuditResourceCell } from './AuditResourceCell';

afterEach(() => {
  cleanup();
});

describe('AuditResourceCell', () => {
  it('links an onboarding row to that onboarding’s details page', () => {
    render(
      <MemoryRouter>
        <AuditResourceCell
          resourceType="onboarding"
          resourceId="01a023ea-0000-7000-8000-0000000003dd1a"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: '01a023ea-0000-7000-8000-0000000003dd1a' }),
    ).toHaveAttribute('href', buildOnboardingDetailsPath('01a023ea-0000-7000-8000-0000000003dd1a'));
  });

  it('links a connector_settings row to /connectors', () => {
    render(
      <MemoryRouter>
        <AuditResourceCell resourceType="connector_settings" resourceId="sumsub_kyc" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'sumsub_kyc' })).toHaveAttribute('href', '/connectors');
  });

  it('renders no link for a resource type with nowhere to go', () => {
    render(
      <MemoryRouter>
        <AuditResourceCell resourceType="client_webhook_outbox" resourceId="wh_1" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('wh_1')).toBeInTheDocument();
  });

  it('renders the full resource id without a middle ellipsis', () => {
    render(
      <MemoryRouter>
        <AuditResourceCell
          resourceType="onboarding"
          resourceId="01a023ea-0000-7000-8000-0000000003dd1a"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('01a023ea-0000-7000-8000-0000000003dd1a')).toBeInTheDocument();
  });
});
