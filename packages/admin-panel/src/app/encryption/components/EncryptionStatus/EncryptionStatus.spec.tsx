import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptionStatus } from './EncryptionStatus';
import type { EncryptionKey, EncryptionState } from '@/api/encryption/admin-encryption';

afterEach(() => {
  cleanup();
});

function createKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    createdAt: '2026-09-17T09:00:36.572Z',
    createdBy: 'operator-oid',
    activatedAt: '2026-09-17T09:00:51.557Z',
    deletedAt: null,
    active: true,
    pendingActivation: false,
    ...overrides,
  };
}

function createState(overrides: Partial<EncryptionState> = {}): EncryptionState {
  return {
    enabled: true,
    keyConfigured: true,
    keys: [createKey()],
    rotation: { interval: '1w', nextRotationAt: '2026-09-24T09:00:36.572Z' },
    progress: { pending: 0, total: 12 },
    reencrypting: false,
    ...overrides,
  };
}

function renderStatus(state: EncryptionState): HTMLElement {
  render(<EncryptionStatus state={state} />);
  return screen.getByRole('region', { name: 'Encryption status' });
}

describe('EncryptionStatus', () => {
  it('reads On with a settled explanation when enabled and a key is active', () => {
    const region = renderStatus(createState());

    expect(within(region).getByText('On')).toBeInTheDocument();
    expect(
      within(region).getByText('New onboarding data is encrypted before it reaches the database.'),
    ).toBeInTheDocument();
  });

  it('reads Turning on while enabled but no key is active yet', () => {
    const region = renderStatus(
      createState({ keys: [createKey({ active: false, pendingActivation: true })] }),
    );

    expect(within(region).getByText('Turning on')).toBeInTheDocument();
    expect(within(region).getByText(/picks the change up within a few seconds/)).toHaveTextContent(
      'Encryption is being turned on.',
    );
  });

  it('reads Turning off while disabled but a key is still active', () => {
    const region = renderStatus(createState({ enabled: false }));

    expect(within(region).getByText('Turning off')).toBeInTheDocument();
    expect(within(region).getByText(/picks the change up within a few seconds/)).toHaveTextContent(
      'Encryption is being turned off.',
    );
  });

  it('reads Off with the plain-JSON explanation when disabled and nothing is active', () => {
    const region = renderStatus(
      createState({
        enabled: false,
        keys: [createKey({ active: false, deletedAt: '2026-09-17T10:00:00.000Z' })],
      }),
    );

    expect(within(region).getByText('Off')).toBeInTheDocument();
    expect(
      within(region).getByText('New onboarding data is stored as plain JSON.'),
    ).toBeInTheDocument();
  });

  it('replaces the explanation with the missing-key instruction when no ENCRYPTION_KEY is configured', () => {
    const region = renderStatus(createState({ enabled: false, keys: [], keyConfigured: false }));

    expect(within(region).getByText('Off')).toBeInTheDocument();
    expect(
      within(region).getByText(
        'The engine has no ENCRYPTION_KEY configured, so encryption cannot be turned on. Set it and restart the engine.',
      ),
    ).toBeInTheDocument();
    expect(
      within(region).queryByText('New onboarding data is stored as plain JSON.'),
    ).not.toBeInTheDocument();
  });
});
