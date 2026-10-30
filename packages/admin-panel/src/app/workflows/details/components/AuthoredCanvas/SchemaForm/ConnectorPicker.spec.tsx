import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchConnectors, type Connector } from '@/api/connectors/connectors';
import { ConnectorPicker, readConnectorTypes } from './ConnectorPicker';

vi.mock('@/api/connectors/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors/connectors')>()),
  fetchConnectors: vi.fn(),
}));

const mockedFetchConnectors = vi.mocked(fetchConnectors);

function makeConnector(id: string, type: string, configured = true): Connector {
  return {
    id,
    type,
    name: id.toUpperCase(),
    configured,
    settings: [],
    updatedAt: null,
    updatedBy: null,
  };
}

beforeEach(() => {
  mockedFetchConnectors.mockReset();
  mockedFetchConnectors.mockResolvedValue([
    makeConnector('smtp', 'email_delivery'),
    makeConnector('mailgun', 'email_delivery', false),
    makeConnector('twilio', 'sms_delivery'),
  ]);
});

afterEach(() => {
  cleanup();
});

function renderPicker(
  props: Partial<Parameters<typeof ConnectorPicker>[0]> = {},
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectorPicker
        types={['email_delivery']}
        value=""
        onChange={onChange}
        readOnly={false}
        label="Id"
        {...props}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('ConnectorPicker', () => {
  it('lists only the connectors of the accepted types', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(await screen.findByRole('combobox', { name: 'Id' }));

    expect(await screen.findByRole('option', { name: 'SMTP · smtp' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'MAILGUN · mailgun (not configured)' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /twilio/ })).not.toBeInTheDocument();
  });

  it('emits the id of the chosen connector', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(await screen.findByRole('combobox', { name: 'Id' }));
    await user.click(await screen.findByRole('option', { name: 'SMTP · smtp' }));

    expect(onChange).toHaveBeenCalledWith('smtp');
  });

  it('keeps a stored id the engine no longer lists, marked as not available', async () => {
    renderPicker({ value: 'gone' });

    expect(await screen.findByRole('combobox', { name: 'Id' })).toHaveTextContent(
      'gone (not available)',
    );
  });

  it('falls back to a typeable id when the connectors fail to load', async () => {
    mockedFetchConnectors.mockRejectedValue(new Error('down'));
    const onChange = renderPicker();

    const input = await screen.findByPlaceholderText('Connectors unavailable');
    await userEvent.setup().type(input, 'x');

    expect(onChange).toHaveBeenCalledWith('x');
  });
});

describe('readConnectorTypes', () => {
  it('reads the capabilities from a binding with an id and a type enum', () => {
    expect(
      readConnectorTypes({
        properties: { id: { type: 'string' }, type: { enum: ['email_delivery', 'sms_delivery'] } },
      }),
    ).toEqual(['email_delivery', 'sms_delivery']);
  });

  it('returns null for an object that is no connector binding', () => {
    expect(readConnectorTypes({ properties: { id: { type: 'string' } } })).toBeNull();
    expect(
      readConnectorTypes({ properties: { id: { type: 'string' }, type: { enum: ['other'] } } }),
    ).toBeNull();
  });
});
