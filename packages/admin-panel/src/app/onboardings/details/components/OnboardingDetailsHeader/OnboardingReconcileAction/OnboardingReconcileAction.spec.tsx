import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminOnboardingPendingConnector } from '@/api/onboardings/admin-onboardings';
import { OnboardingReconcileAction } from './OnboardingReconcileAction';

const PENDING_CONNECTOR: AdminOnboardingPendingConnector = {
  connectorId: 'veriff_kyc',
  connectorName: 'Veriff',
  connectorOrder: 0,
  parkedAt: '2026-07-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
});

describe('OnboardingReconcileAction', () => {
  it('renders nothing when the onboarding is not parked on a connector', () => {
    const { container } = render(
      <OnboardingReconcileAction pendingConnector={null} disabled={false} onReconcile={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers the check, named after the connector it asks, while parked', async () => {
    const user = userEvent.setup();
    const onReconcile = vi.fn();
    render(
      <OnboardingReconcileAction
        pendingConnector={PENDING_CONNECTOR}
        disabled={false}
        onReconcile={onReconcile}
      />,
    );

    const button = screen.getByRole('button', { name: 'Check provider' });
    expect(button).toHaveAttribute('title', 'Ask Veriff for its verdict');
    await user.click(button);

    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it('is inert while another header action is in flight', () => {
    render(
      <OnboardingReconcileAction
        pendingConnector={PENDING_CONNECTOR}
        disabled
        onReconcile={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Check provider' })).toBeDisabled();
  });
});
