import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findStepType, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { fetchConnectors, type Connector } from '@/api/connectors/connectors';
import type { Schema } from '../../../utils/config-schema';
import { ConfigFormContext } from './config-form-context';
import { SchemaForm } from './SchemaForm';

vi.mock('@/api/connectors/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors/connectors')>()),
  fetchConnectors: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchConnectors).mockResolvedValue([]);
});

afterEach(cleanup);

const configSchema = (type: string): Schema => findStepType(type)?.buildConfigSchema() as Schema;

function renderConfig(stepType: string, schema: Schema, value: unknown): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfigFormContext.Provider value={{ stepType, renameField: null, failures: {} }}>
        <SchemaForm schema={schema} value={value} readOnly={false} onChange={vi.fn()} />
      </ConfigFormContext.Provider>
    </QueryClientProvider>,
  ).container;
}

describe('ObjectForm hints', () => {
  it("shows the hint on a field's when row", () => {
    renderConfig(STEP_TYPE.form, configSchema(STEP_TYPE.form), {
      fields: { b: { type: 'text', when: { field: 'a', isSet: true } } },
    });

    expect(
      screen.getByText('Asks for the field only when this holds; otherwise it must be left out.'),
    ).toBeInTheDocument();
  });

  it('gives fallback on a decision and fallback in a connector declaration different hints', () => {
    renderConfig(STEP_TYPE.decision, configSchema(STEP_TYPE.decision), {
      branches: [{ port: 'yes', when: { field: 'x', isSet: true } }],
      fallback: true,
    });
    renderConfig(
      STEP_TYPE.kycIdentityVerification,
      configSchema(STEP_TYPE.kycIdentityVerification),
      { connector: { id: 'sumsub' } },
    );

    expect(screen.getAllByText('Adds a default port for when no branch matches.')).toHaveLength(1);
    expect(screen.getAllByText('Backup providers of the same type, tried in order.')).toHaveLength(
      1,
    );
  });

  it('renders no helper text for a key without a hint', () => {
    renderConfig(
      STEP_TYPE.decision,
      { type: 'object', required: ['plain'], properties: { plain: { type: 'string' } } },
      { plain: 'x' },
    );

    const row = screen.getByText('Plain').closest('div')!.parentElement!;
    expect(row.children).toHaveLength(2);
  });
});

function makeConnector(id: string, type: string): Connector {
  return { id, type, name: id, configured: true, settings: [], updatedAt: null, updatedBy: null };
}

describe('ObjectForm connector bindings', () => {
  beforeEach(() => {
    vi.mocked(fetchConnectors).mockResolvedValue([
      makeConnector('smtp', 'email_delivery'),
      makeConnector('twilio', 'sms_delivery'),
      makeConnector('vonage', 'sms_delivery'),
    ]);
  });

  it("offers a fallback only the connectors of the primary's type and hides its type", async () => {
    const user = userEvent.setup();
    renderConfig(STEP_TYPE.notify, configSchema(STEP_TYPE.notify), {
      connector: { id: 'twilio', type: 'sms_delivery', fallback: [{ id: 'vonage' }] },
      recipientField: 'phone',
    });

    const [, fallbackId] = await screen.findAllByRole('combobox', { name: 'Id' });
    await user.click(fallbackId!);
    const listbox = await screen.findByRole('listbox');

    expect(within(listbox).getByRole('option', { name: 'vonage · vonage' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /smtp/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Type')).toHaveLength(1);
  });

  it('drops the ids in the chain when the primary type changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ConfigFormContext.Provider
          value={{ stepType: STEP_TYPE.notify, renameField: null, failures: {} }}
        >
          <SchemaForm
            schema={configSchema(STEP_TYPE.notify)}
            value={{
              connector: { id: 'twilio', type: 'sms_delivery', fallback: [{ id: 'vonage' }] },
              recipientField: 'phone',
            }}
            readOnly={false}
            onChange={onChange}
          />
        </ConfigFormContext.Provider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'email_delivery' }));

    expect(onChange).toHaveBeenCalledWith({
      connector: { type: 'email_delivery', fallback: [{}] },
      recipientField: 'phone',
    });
  });
});
