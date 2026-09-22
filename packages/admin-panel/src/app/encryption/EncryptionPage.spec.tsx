import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncryptionPage } from './EncryptionPage';
import {
  addEncryptionKey,
  EncryptionFetchError,
  EncryptionWriteError,
  fetchEncryptionState,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
} from './api/admin-encryption';
import type { EncryptionKey, EncryptionState } from './types/encryption';

vi.mock('./api/admin-encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/admin-encryption')>();

  return {
    ...actual,
    fetchEncryptionState: vi.fn(),
    setEncryptionEnabled: vi.fn(),
    setEncryptionRotationInterval: vi.fn(),
    addEncryptionKey: vi.fn(),
  };
});

const mockedFetchEncryptionState = vi.mocked(fetchEncryptionState);
const mockedSetEncryptionEnabled = vi.mocked(setEncryptionEnabled);
const mockedSetEncryptionRotationInterval = vi.mocked(setEncryptionRotationInterval);
const mockedAddEncryptionKey = vi.mocked(addEncryptionKey);

const ACTIVE_KEY_ID = '01a0ae98-ad4d-72ac-9f17-74e08efa00fd';
const PENDING_KEY_ID = '01a0ae98-73f5-7287-b137-2b6ee967156e';
const SUPERSEDED_KEY_ID = '01a0ae98-0000-7000-8000-000000000001';

function createKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: ACTIVE_KEY_ID,
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

const OFF_STATE = createState({ enabled: false, keys: [], progress: { pending: 0, total: 12 } });

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
    <MemoryRouter initialEntries={['/encryption']}>
      <QueryClientProvider client={client}>
        <EncryptionPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The page's own status line — the first live region; the sweep's progress line is the second. */
function statusLine(): HTMLElement {
  return screen.getAllByRole('status')[0];
}

async function renderReady(state: EncryptionState = createState()): Promise<void> {
  mockedFetchEncryptionState.mockResolvedValueOnce(state);
  renderPage();
  await waitFor(() => {
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('region', { name: 'Encryption status' });
}

beforeEach(() => {
  mockedFetchEncryptionState.mockReset();
  mockedSetEncryptionEnabled.mockReset();
  mockedSetEncryptionRotationInterval.mockReset();
  mockedAddEncryptionKey.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('EncryptionPage', () => {
  it('shows a loading status and nothing else while the state is being fetched', () => {
    const { promise } = deferred<EncryptionState>();
    mockedFetchEncryptionState.mockReturnValueOnce(promise);

    renderPage();

    expect(statusLine()).toHaveTextContent('Loading encryption settings…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Encryption status' })).not.toBeInTheDocument();
  });

  it('explains a failed request instead of showing an empty page', async () => {
    mockedFetchEncryptionState.mockRejectedValueOnce(
      new EncryptionFetchError('request-failed', 'Request failed with status 500.', 500),
    );

    renderPage();

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Unable to load encryption settings: Request failed with status 500.',
      );
    });
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('summarises the state and renders one card per key, in each of the three chip states', async () => {
    await renderReady(
      createState({
        keys: [
          createKey({ id: PENDING_KEY_ID, active: false, pendingActivation: true }),
          createKey(),
          createKey({
            id: SUPERSEDED_KEY_ID,
            createdBy: null,
            active: false,
            deletedAt: '2026-09-17T09:00:36.575Z',
          }),
        ],
      }),
    );

    expect(statusLine()).toHaveTextContent('Encryption is on. Showing 3 encryption keys.');
    expect(
      within(screen.getByRole('region', { name: 'Encryption status' })).getByText('On'),
    ).toBeInTheDocument();

    const pendingCard = screen.getByRole('group', { name: `Encryption key ${PENDING_KEY_ID}` });
    const activeCard = screen.getByRole('group', { name: `Encryption key ${ACTIVE_KEY_ID}` });
    const supersededCard = screen.getByRole('group', {
      name: `Encryption key ${SUPERSEDED_KEY_ID}`,
    });
    expect(within(pendingCard).getByText('Pending activation')).toBeInTheDocument();
    expect(within(activeCard).getByText('Active')).toBeInTheDocument();
    expect(within(supersededCard).getByText('Retired')).toBeInTheDocument();
    expect(within(supersededCard).getByText('Added outside the panel')).toBeInTheDocument();
  });

  it('shows the off state with the empty key message and no Add key action', async () => {
    await renderReady(OFF_STATE);

    expect(statusLine()).toHaveTextContent('Encryption is off. Showing 0 encryption keys.');
    expect(
      screen.getByText('No encryption keys yet. Turn encryption on to create the first one.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add key' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('disables only the toggle when the engine has no ENCRYPTION_KEY, and says why', async () => {
    await renderReady(createState({ ...OFF_STATE, keyConfigured: false }));

    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(
      screen.getByText(
        'The engine has no ENCRYPTION_KEY configured, so encryption cannot be turned on. Set it and restart the engine.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No encryption keys yet. Turn encryption on to create the first one.'),
    ).toBeInTheDocument();
  });

  it('also disables Add key when encryption is on but the key-encryption key has gone missing', async () => {
    await renderReady(createState({ keyConfigured: false }));

    expect(screen.getByRole('button', { name: 'Turn encryption off' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add key' })).toBeDisabled();
  });

  it('turns encryption on behind a two-click confirm, sends the PATCH body, and reports success', async () => {
    const user = userEvent.setup();
    await renderReady(OFF_STATE);

    const turnedOn = createState({
      keys: [createKey({ active: false, pendingActivation: true })],
      progress: { pending: 12, total: 12 },
    });
    mockedSetEncryptionEnabled.mockResolvedValueOnce(turnedOn);

    await user.click(screen.getByRole('button', { name: 'Turn encryption on' }));
    expect(mockedSetEncryptionEnabled).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This encrypts every stored onboarding in the background. Turn encryption on?',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm turn on' }));

    await waitFor(() => {
      expect(mockedSetEncryptionEnabled).toHaveBeenCalledWith(true);
    });
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Encryption turned on. Existing onboardings are being encrypted in the background.',
      );
    });
    // The PATCH's answer is the new state; no separate re-read follows it.
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Turn encryption off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Encryption status' })).getByText('Turning on'),
    ).toBeInTheDocument();
  });

  it('turns encryption off behind a two-click confirm in danger colour, and reports success', async () => {
    const user = userEvent.setup();
    await renderReady();

    const turnedOff = createState({ enabled: false, progress: { pending: 12, total: 12 } });
    mockedSetEncryptionEnabled.mockResolvedValueOnce(turnedOff);

    await user.click(screen.getByRole('button', { name: 'Turn encryption off' }));
    expect(mockedSetEncryptionEnabled).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This decrypts every stored onboarding and stores it as plain JSON. Turn encryption off?',
      ),
    ).toHaveClass('text-tsh-red');

    await user.click(screen.getByRole('button', { name: 'Confirm turn off' }));

    await waitFor(() => {
      expect(mockedSetEncryptionEnabled).toHaveBeenCalledWith(false);
    });
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Encryption turned off. Existing onboardings are being decrypted in the background.',
      );
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add key' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Encryption status' })).getByText('Turning off'),
    ).toBeInTheDocument();
  });

  it('cancels a toggle without sending anything', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Turn encryption off' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockedSetEncryptionEnabled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn encryption off' })).toBeInTheDocument();
  });

  it('reports a refused toggle without refetching', async () => {
    const user = userEvent.setup();
    await renderReady(OFF_STATE);

    mockedSetEncryptionEnabled.mockRejectedValueOnce(
      new EncryptionWriteError(
        'Another change to the encryption keys landed at the same moment. Refresh and try again.',
        409,
        'ENCRYPTION_KEY_RING_CONFLICT',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Turn encryption on' }));
    await user.click(screen.getByRole('button', { name: 'Confirm turn on' }));

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Unable to turn encryption on: Another change to the encryption keys landed at the same moment. Refresh and try again.',
      );
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Turn encryption on' })).toBeEnabled();
  });

  it('requires a two-click confirm before adding a key, then reports success and refetches', async () => {
    const user = userEvent.setup();
    await renderReady();

    mockedAddEncryptionKey.mockResolvedValueOnce(PENDING_KEY_ID);
    mockedFetchEncryptionState.mockResolvedValueOnce(
      createState({
        keys: [
          createKey({ id: PENDING_KEY_ID, active: false, pendingActivation: true }),
          createKey(),
        ],
        progress: { pending: 12, total: 12 },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    expect(mockedAddEncryptionKey).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));

    await waitFor(() => {
      expect(mockedAddEncryptionKey).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Added a new encryption key. New data uses it once it activates; stored onboardings move onto it as they are next written.',
      );
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('group', { name: `Encryption key ${PENDING_KEY_ID}` }),
    ).toBeInTheDocument();
  });

  it('reports a refused rotation without refetching', async () => {
    const user = userEvent.setup();
    await renderReady();

    mockedAddEncryptionKey.mockRejectedValueOnce(
      new EncryptionWriteError(
        'Encryption is turned off, so there is no key to rotate.',
        409,
        'ENCRYPTION_DISABLED',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.click(screen.getByRole('button', { name: 'Confirm add key' }));

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Unable to add a key: Encryption is turned off, so there is no key to rotate.',
      );
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });

  it('applies a chosen rotation interval on the first change and reports it', async () => {
    const user = userEvent.setup();
    await renderReady();

    const scheduled = createState({
      rotation: { interval: '48h', nextRotationAt: '2099-09-19T09:00:36.572Z' },
    });
    mockedSetEncryptionRotationInterval.mockResolvedValueOnce(scheduled);

    await user.selectOptions(screen.getByLabelText('Automatic key rotation'), 'Every 48 hours');

    expect(mockedSetEncryptionRotationInterval).toHaveBeenCalledWith('48h');
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent('Automatic key rotation set to: every 48 hours.');
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });

  it('turns automatic rotation off, and says the key then changes only on request', async () => {
    const user = userEvent.setup();
    await renderReady();

    mockedSetEncryptionRotationInterval.mockResolvedValueOnce(
      createState({ rotation: { interval: null, nextRotationAt: null } }),
    );

    await user.selectOptions(
      screen.getByLabelText('Automatic key rotation'),
      'Off — rotate only on request',
    );

    expect(mockedSetEncryptionRotationInterval).toHaveBeenCalledWith(null);
    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Automatic key rotation turned off. The key now changes only when you add one.',
      );
    });
  });

  it('reports a refused schedule change without touching the state', async () => {
    const user = userEvent.setup();
    await renderReady();

    mockedSetEncryptionRotationInterval.mockRejectedValueOnce(
      new EncryptionWriteError(
        'Encryption is turned off, so there is no key to rotate.',
        409,
        'ENCRYPTION_DISABLED',
      ),
    );

    await user.selectOptions(screen.getByLabelText('Automatic key rotation'), 'Every 2 weeks');

    await waitFor(() => {
      expect(statusLine()).toHaveTextContent(
        'Unable to change automatic key rotation: Encryption is turned off, so there is no key to rotate.',
      );
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });

  it('offers no rotation schedule while encryption is off: there is no key to schedule', async () => {
    await renderReady(
      createState({ ...OFF_STATE, rotation: { interval: null, nextRotationAt: null } }),
    );

    expect(screen.queryByLabelText('Automatic key rotation')).not.toBeInTheDocument();
  });

  it('cannot be scheduled when the engine has no ENCRYPTION_KEY', async () => {
    await renderReady(createState({ keyConfigured: false }));

    expect(screen.getByLabelText('Automatic key rotation')).toBeDisabled();
  });

  it('keeps Refresh available with nothing pending, and re-reads the state on click', async () => {
    const user = userEvent.setup();
    await renderReady();

    expect(screen.getAllByRole('status')).toHaveLength(1);

    mockedFetchEncryptionState.mockResolvedValueOnce(
      createState({ progress: { pending: 3, total: 10 } }),
    );

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          'Encrypting stored onboardings onto the active key: 7 of 10 done, 3 remaining.',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('words the progress line for the decrypting sweep while encryption is off', async () => {
    await renderReady(
      createState({
        enabled: false,
        keys: [createKey({ active: false, deletedAt: '2026-09-17T10:00:00.000Z' })],
        progress: { pending: 5, total: 12 },
      }),
    );

    expect(
      screen.getByText('Decrypting stored onboardings: 7 of 12 done, 5 remaining.'),
    ).toBeInTheDocument();
  });

  it('hides the progress line once nothing is pending', async () => {
    await renderReady(createState({ progress: { pending: 0, total: 12 } }));

    expect(screen.queryByText(/stored onboardings/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});
