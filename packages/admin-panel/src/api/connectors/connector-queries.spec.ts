import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectorQueries } from './connector-queries';
import { fetchConnectors, type Connector } from './connectors';

vi.mock('./connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connectors')>()),
  fetchConnectors: vi.fn(),
}));

const mockedFetchConnectors = vi.mocked(fetchConnectors);

const CONNECTORS: Connector[] = [
  {
    id: 'smtp',
    type: 'email_delivery',
    name: 'SMTP',
    configured: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
  },
];

beforeEach(() => {
  mockedFetchConnectors.mockReset();
  mockedFetchConnectors.mockResolvedValue(CONNECTORS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connectorQueries', () => {
  it('builds the key hierarchy exactly as pinned', () => {
    expect(connectorQueries.all()).toEqual(['connectors']);
    expect(connectorQueries.lists()).toEqual(['connectors', 'list']);
    expect(connectorQueries.list().queryKey).toEqual(['connectors', 'list']);
  });

  it('fetches the connector list across the module boundary', async () => {
    const options = connectorQueries.list();

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchConnectors).toHaveBeenCalledWith();
  });
});
