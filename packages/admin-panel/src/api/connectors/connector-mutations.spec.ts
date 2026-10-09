import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectorMutations } from './connector-mutations';
import { connectorQueries } from './connector-queries';
import { deleteConnectorSettings, patchConnectorSettings } from './connectors';

vi.mock('./connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connectors')>()),
  patchConnectorSettings: vi.fn(),
  deleteConnectorSettings: vi.fn(),
}));

const mockedPatchConnectorSettings = vi.mocked(patchConnectorSettings);
const mockedDeleteConnectorSettings = vi.mocked(deleteConnectorSettings);

// TanStack passes a mutation context as the second argument; these factories ignore it.
const CONTEXT = {} as never;

beforeEach(() => {
  mockedPatchConnectorSettings.mockReset();
  mockedDeleteConnectorSettings.mockReset();
});

describe('connectorMutations.save', () => {
  it('patches the connector settings with the given changes', async () => {
    mockedPatchConnectorSettings.mockResolvedValueOnce({} as never);

    await connectorMutations
      .save()
      .mutationFn?.({ connectorId: 'smtp', changes: { 'smtp.username': 'ops' } }, CONTEXT);

    expect(mockedPatchConnectorSettings).toHaveBeenCalledWith('smtp', { 'smtp.username': 'ops' });
  });

  it('invalidates the connector lists', () => {
    expect(connectorMutations.save().meta).toEqual({
      invalidates: [connectorQueries.lists()],
    });
  });
});

describe('connectorMutations.clear', () => {
  it('deletes the connector settings', async () => {
    mockedDeleteConnectorSettings.mockResolvedValueOnce(undefined);

    await connectorMutations.clear().mutationFn?.('smtp', CONTEXT);

    expect(mockedDeleteConnectorSettings).toHaveBeenCalledWith('smtp');
  });

  it('invalidates the connector lists', () => {
    expect(connectorMutations.clear().meta).toEqual({
      invalidates: [connectorQueries.lists()],
    });
  });
});
