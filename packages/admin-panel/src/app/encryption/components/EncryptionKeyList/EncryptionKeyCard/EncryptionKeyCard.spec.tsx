import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptionKeyCard } from './EncryptionKeyCard';
import type { EncryptionKey } from '../../../types/encryption';

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

function renderCard(encryptionKey: EncryptionKey): HTMLElement {
  render(<EncryptionKeyCard encryptionKey={encryptionKey} />);
  return screen.getByRole('group', { name: `Encryption key ${encryptionKey.id}` });
}

describe('EncryptionKeyCard', () => {
  it('renders the id in monospace with the created, activated and deleted timestamps', () => {
    const card = renderCard(createKey({ deletedAt: '2026-09-17T09:05:00.000Z' }));

    expect(within(card).getByText('01a0ae98-ad4d-72ac-9f17-74e08efa00fd')).toHaveClass('font-mono');
    expect(within(card).getByText('Created')).toBeInTheDocument();
    expect(within(card).getByText('Activated')).toBeInTheDocument();
    expect(within(card).getByText('Deleted')).toBeInTheDocument();
    // Three real timestamps, none of them the not-set dash.
    expect(within(card).queryByText('-')).not.toBeInTheDocument();
  });

  it('shows a dash for a key that has not been deleted', () => {
    const card = renderCard(createKey({ deletedAt: null }));

    expect(within(card).getByText('-')).toBeInTheDocument();
  });

  it('marks the active key', () => {
    const card = renderCard(createKey({ active: true }));

    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).queryByText('Pending activation')).not.toBeInTheDocument();
    expect(within(card).queryByText('Retired')).not.toBeInTheDocument();
  });

  it('marks a key still inside its activation grace window', () => {
    const card = renderCard(createKey({ active: false, pendingActivation: true }));

    expect(within(card).getByText('Pending activation')).toBeInTheDocument();
    expect(within(card).queryByText('Active')).not.toBeInTheDocument();
  });

  it('marks a key that is neither active nor pending as superseded', () => {
    const card = renderCard(
      createKey({ active: false, pendingActivation: false, deletedAt: '2026-09-17T09:05:00.000Z' }),
    );

    expect(within(card).getByText('Retired')).toBeInTheDocument();
    expect(within(card).queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows an engine-provisioned key as distinct from an operator-added one', () => {
    render(<EncryptionKeyCard encryptionKey={createKey({ createdBy: null })} />);
    expect(screen.getByText('Provisioned by the engine')).toBeInTheDocument();

    cleanup();

    render(<EncryptionKeyCard encryptionKey={createKey({ createdBy: 'operator@tsh.io' })} />);
    expect(screen.getByText('Added by operator@tsh.io')).toBeInTheDocument();
  });

  it('never renders anything resembling key material', () => {
    render(<EncryptionKeyCard encryptionKey={createKey()} />);

    // The type has no field for it and the DOM must not either — a smoke check that nothing was
    // later bolted onto the card with a wrapped key or similar leaking through.
    expect(screen.queryByText(/wrapped/i)).not.toBeInTheDocument();
  });
});
