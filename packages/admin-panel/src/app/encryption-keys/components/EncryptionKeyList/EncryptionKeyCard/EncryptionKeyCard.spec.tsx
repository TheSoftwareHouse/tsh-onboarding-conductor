import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EncryptionKey } from '../../../types/encryption-key';
import { EncryptionKeyCard } from './EncryptionKeyCard';

afterEach(() => {
  cleanup();
});

function createKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    createdAt: '2026-09-17T09:00:36.572Z',
    createdBy: 'unknown',
    activatedAt: '2026-09-17T09:00:36.557Z',
    deletedAt: null,
    active: true,
    ...overrides,
  };
}

describe('EncryptionKeyCard', () => {
  it('renders the id, created, activated and deleted timestamps', () => {
    render(
      <EncryptionKeyCard encryptionKey={createKey({ deletedAt: '2026-09-17T09:05:00.000Z' })} />,
    );

    const card = screen.getByRole('group', {
      name: 'Encryption key 01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    });
    expect(within(card).getByText('01a0ae98-ad4d-72ac-9f17-74e08efa00fd')).toBeInTheDocument();
    expect(within(card).getByText('Created')).toBeInTheDocument();
    expect(within(card).getByText('Activated')).toBeInTheDocument();
    expect(within(card).getByText('Deleted')).toBeInTheDocument();
  });

  it('marks the active key distinctly from a superseded one', () => {
    render(<EncryptionKeyCard encryptionKey={createKey({ active: true })} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Superseded')).not.toBeInTheDocument();

    cleanup();

    render(
      <EncryptionKeyCard
        encryptionKey={createKey({ active: false, deletedAt: '2026-09-17T09:05:00.000Z' })}
      />,
    );
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows a system-provisioned key as distinct from an operator-added one', () => {
    render(<EncryptionKeyCard encryptionKey={createKey({ createdBy: null })} />);
    expect(screen.getByText('Provisioned automatically at first boot')).toBeInTheDocument();

    cleanup();

    render(<EncryptionKeyCard encryptionKey={createKey({ createdBy: 'operator@tsh.io' })} />);
    expect(screen.getByText('Added by operator@tsh.io')).toBeInTheDocument();
  });

  it('never renders anything resembling key material', () => {
    const key = createKey();
    render(<EncryptionKeyCard encryptionKey={key} />);

    // The type has no field for it and the DOM must not either — this is a smoke check that
    // nothing was later bolted onto the card with a wrapped key or similar leaking through.
    expect(screen.queryByText(/wrapped/i)).not.toBeInTheDocument();
  });
});
