import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findStepType, STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { fetchConnectors } from '@/api/connectors/connectors';
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
