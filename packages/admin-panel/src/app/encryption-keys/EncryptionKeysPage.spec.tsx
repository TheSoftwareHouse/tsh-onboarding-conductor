import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncryptionKeysPage } from './EncryptionKeysPage';
import {
  addEncryptionKey,
  AddEncryptionKeyError,
  EncryptionKeysFetchError,
  fetchEncryptionKeys,
} from './api/admin-encryption-keys';
import type { EncryptionKey } from './types/encryption-key';

vi.mock('./api/admin-encryption-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/admin-encryption-keys')>();

  return {
    ...actual,
    fetchEncryptionKeys: vi.fn(),
    addEncryptionKey: vi.fn(),
  };
});

const mockedFetchEncryptionKeys = vi.mocked(fetchEncryptionKeys);
const mockedAddEncryptionKey = vi.mocked(addEncryptionKey);

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderPage(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });

  return render(
    <MemoryRouter initialEntries={['/encryption-keys']}>
      <QueryClientProvider client={client}>
        <EncryptionKeysPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function renderReady(
  keys: EncryptionKey[],
  reEncryption: { pending: number; total: number } = { pending: 0, total: 0 },
): Promise<void> {
  mockedFetchEncryptionKeys.mockResolvedValueOnce({ keys, reEncryption });
  renderPage();
  await waitFor(() => {
    expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(1);
  });
  await screen.findAllByRole('status');
}

beforeEach(() => {
  mockedFetchEncryptionKeys.mockReset();
  mockedAddEncryptionKey.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('EncryptionKeysPage', () => {
  it('shows a loading status while the list is being fetched', () => {
    const { promise } = deferred<{
      keys: EncryptionKey[];
      reEncryption: { pending: number; total: number };
    }>();
    mockedFetchEncryptionKeys.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading encryption keys…');
  });

  it('explains a failed request instead of showing an empty list', async () => {
    mockedFetchEncryptionKeys.mockRejectedValueOnce(
      new EncryptionKeysFetchError('request-failed', 'Request failed with status 500.', 500),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(
        'Unable to load encryption keys: Request failed with status 500.',
      );
    });
  });

  it('renders one card per key, marking the active one', async () => {
    await renderReady([
      createKey({ active: true }),
      createKey({
        id: '01a0ae98-73f5-7287-b137-2b6ee967156e',
        createdBy: null,
        active: false,
        deletedAt: '2026-09-17T09:00:36.575Z',
      }),
    ]);

    expect(
      screen.getByRole('group', { name: 'Encryption key 01a0ae98-ad4d-72ac-9f17-74e08efa00fd' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Encryption key 01a0ae98-73f5-7287-b137-2b6ee967156e' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    expect(screen.getByText('Provisioned automatically at first boot')).toBeInTheDocument();
  });

  it('shows a disabled empty state instead of a blank screen when encryption is off', async () => {
    await renderReady([]);

    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Encryption is not enabled.');
    expect(
      screen.getByText('Encryption is not enabled, so there is no key history to show.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });

  it('shows re-encryption progress and a Refresh control while pending is above zero, and hides both at zero', async () => {
    await renderReady([createKey()], { pending: 3, total: 10 });

    expect(
      screen.getByText(
        'Re-encrypting existing onboarding data onto the new key: 7 of 10 done, 3 remaining.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();

    cleanup();
    mockedFetchEncryptionKeys.mockReset();
    await renderReady([createKey()], { pending: 0, total: 10 });

    expect(screen.queryByText(/Re-encrypting existing onboarding data/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('lets the operator re-read progress with Refresh until it reaches zero, without navigating away', async () => {
    const user = userEvent.setup();
    await renderReady([createKey()], { pending: 3, total: 10 });

    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [createKey()],
      reEncryption: { pending: 0, total: 10 },
    });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Re-encrypting existing onboarding data/)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('requires a two-click confirm before adding a key, then reports success and refetches', async () => {
    const user = userEvent.setup();
    await renderReady([createKey()]);

    mockedAddEncryptionKey.mockResolvedValueOnce('new-key-id');
    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [createKey({ id: 'new-key-id' }), createKey({ active: false })],
      reEncryption: { pending: 1, total: 2 },
    });

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    expect(mockedAddEncryptionKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));

    await waitFor(() => {
      expect(mockedAddEncryptionKey).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          'Added a new encryption key. Re-encryption has started in the background.',
        ),
      ).toBeInTheDocument();
    });
    expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(2);
  });

  it('reports a refused rotation without refetching the list', async () => {
    const user = userEvent.setup();
    await renderReady([createKey()]);

    mockedAddEncryptionKey.mockRejectedValueOnce(
      new AddEncryptionKeyError(
        'Encryption is not enabled, so there is no key to rotate.',
        409,
        true,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Unable to add a key: Encryption is not enabled, so there is no key to rotate.',
        ),
      ).toBeInTheDocument();
    });
    expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(1);
  });
});
