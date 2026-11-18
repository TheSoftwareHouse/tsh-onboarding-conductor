import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import type { AuthoredStep } from '../../../utils/authored-document';
import { StepSections } from './StepSections';

afterEach(cleanup);

// The request form draws its maps in schema order: headers, query, body.
const HEADERS_MAP = 0;

type Config = Record<string, unknown>;

/** Holds the step's config the way the document does, so edits accumulate. */
function Harness({
  initial,
  onConfig,
}: {
  initial: Config;
  onConfig: (config: Config) => void;
}): ReactElement {
  const [config, setConfig] = useState(initial);
  const step = { name: 'call', type: STEP_TYPE.httpCall, config } as AuthoredStep;
  return (
    <StepSections
      step={step}
      storedFields={[]}
      readOnly={false}
      onConfig={(_, next) => {
        setConfig(next);
        onConfig(next);
      }}
      onRenameField={vi.fn()}
      onAddSection={vi.fn()}
      onRemoveSection={vi.fn()}
    />
  );
}

function renderHttpCall(request: Config): ReturnType<typeof vi.fn> {
  const onConfig = vi.fn();
  render(<Harness initial={{ request }} onConfig={onConfig} />);
  return onConfig;
}

const lastRequest = (spy: ReturnType<typeof vi.fn>): Config =>
  (spy.mock.calls.at(-1)?.[0] as { request: Config }).request;

describe('StepSections http-call request', () => {
  it('edits a header row as a plain string map', async () => {
    const user = userEvent.setup();
    const onConfig = renderHttpCall({ method: 'POST', url: 'https://x' });

    await user.type(
      screen.getAllByRole('textbox', { name: 'New name' })[HEADERS_MAP]!,
      'Authorization{Enter}',
    );
    await user.type(screen.getByRole('textbox', { name: 'Authorization value' }), 'Bearer t');

    expect(lastRequest(onConfig).headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('writes the chosen method', async () => {
    const user = userEvent.setup();
    const onConfig = renderHttpCall({ method: 'POST', url: 'https://x' });

    await user.click(screen.getByRole('combobox', { name: 'Method' }));
    await user.click(await screen.findByRole('option', { name: 'PUT' }));

    expect(lastRequest(onConfig).method).toBe('PUT');
  });

  it('keeps a body array in the generic editor without losing it', async () => {
    const user = userEvent.setup();
    const onConfig = renderHttpCall({ method: 'POST', url: 'https://x', body: [1, 2] });

    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue('[1,2]');
    expect(screen.getAllByRole('textbox', { name: 'New name' })).toHaveLength(2);

    await user.type(screen.getByRole('textbox', { name: 'URL' }), '/a');

    expect(lastRequest(onConfig)).toEqual({ method: 'POST', url: 'https://x/a', body: [1, 2] });
  });

  it('shows the placeholder help once, under the request', () => {
    renderHttpCall({ method: 'POST', url: 'https://x' });

    expect(
      screen.getAllByText(
        'Values can use {{payload.key}}, {{secrets.alias.key}}, {{execution.onboardingId}}, {{execution.stepName}}; names cannot.',
      ),
    ).toHaveLength(1);
  });

  it('labels a header value and overrides the url and timeout labels', () => {
    renderHttpCall({ method: 'POST', url: 'https://x', headers: { Accept: 'json' } });

    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Accept value' })).toHaveValue('json');
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.getByText('Timeout (ms)')).toBeInTheDocument();
  });
});
