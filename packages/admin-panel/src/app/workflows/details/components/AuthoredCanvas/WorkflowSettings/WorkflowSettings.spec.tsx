import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoredDocument } from '../../../utils/authored-document';
import { projectDocument } from '../../../utils/authored-projection';
import { WorkflowSettings } from './WorkflowSettings';

afterEach(cleanup);

const DOC: AuthoredDocument = {
  id: 'onboarding',
  version: 3,
  name: 'Onboarding',
  steps: [
    { name: 'collect', type: 'contact-details', config: {} },
    { name: 'done', type: 'terminal', config: { status: 'approved' } },
  ],
};

function renderSettings(
  doc: AuthoredDocument = DOC,
  readOnly = false,
): { onChange: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <WorkflowSettings
      doc={doc}
      steps={projectDocument(doc).steps}
      readOnly={readOnly}
      onChange={onChange}
      onClose={onClose}
    />,
  );
  return { onChange, onClose };
}

describe('WorkflowSettings', () => {
  it('shows the workflow id and version', () => {
    renderSettings();

    expect(screen.getByRole('heading', { name: 'onboarding' })).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
  });

  it('edits the name', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!');

    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).name).toBe('Onboarding!');
  });

  it('drops the name when it is cleared', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings();

    await user.clear(screen.getByRole('textbox', { name: 'Name' }));

    expect('name' in (onChange.mock.calls.at(-1)![0] as AuthoredDocument)).toBe(false);
  });

  it('sets the initial step, and unsets it for the first step', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings({ ...DOC, initial: 'done' });

    await user.click(screen.getByRole('combobox', { name: 'Initial step' }));
    await user.click(await screen.findByRole('option', { name: 'collect' }));
    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).initial).toBe('collect');

    await user.click(screen.getByRole('combobox', { name: 'Initial step' }));
    await user.click(await screen.findByRole('option', { name: 'First step (collect)' }));
    expect('initial' in (onChange.mock.calls.at(-1)![0] as AuthoredDocument)).toBe(false);
  });

  it('closes from the × button', async () => {
    const { onClose } = renderSettings();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('offers no editing controls when read-only', () => {
    renderSettings(DOC, true);

    expect(screen.getByRole('combobox', { name: 'Initial step' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Set / })).not.toBeInTheDocument();
  });
});

describe('WorkflowSettings agreements', () => {
  const AGREE: AuthoredDocument = {
    id: 'onboarding',
    version: 1,
    steps: [
      {
        name: 'terms',
        type: 'custom',
        config: {
          status: 'awaiting_user',
          data: { termsAccepted: { type: 'boolean', required: true } },
          transitions: [{ target: 'privacy' }],
        },
      },
      {
        name: 'privacy',
        type: 'custom',
        config: {
          status: 'awaiting_user',
          data: { privacyAccepted: { type: 'boolean', required: true } },
          transitions: [{ target: 'done' }],
        },
      },
      { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
    ],
  };

  it('adds an agreement on the first step with a yes/no field', async () => {
    const { onChange } = renderSettings(AGREE);

    await userEvent.setup().click(screen.getByRole('button', { name: '+ Add agreement' }));

    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).agreements).toEqual([
      { key: 'terms-accepted', step: 'terms', acceptedWhen: 'termsAccepted' },
    ]);
  });

  it('picks the new step’s first yes/no field when the step changes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSettings({
      ...AGREE,
      agreements: [{ key: 'terms', step: 'terms', acceptedWhen: 'termsAccepted' }],
    });

    await user.click(screen.getByRole('combobox', { name: 'Step of agreement 1' }));
    await user.click(await screen.findByRole('option', { name: 'privacy' }));

    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).agreements).toEqual([
      { key: 'terms', step: 'privacy', acceptedWhen: 'privacyAccepted' },
    ]);
  });

  it('offers only steps with a yes/no field to track as the agreement’s step', async () => {
    const user = userEvent.setup();
    renderSettings({
      ...AGREE,
      agreements: [{ key: 'terms', step: 'terms', acceptedWhen: 'termsAccepted' }],
    });

    await user.click(screen.getByRole('combobox', { name: 'Step of agreement 1' }));

    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'terms',
      'privacy',
    ]);
  });

  it('removes the agreements key with the last agreement', async () => {
    const { onChange } = renderSettings({
      ...AGREE,
      agreements: [{ key: 'terms', step: 'terms', acceptedWhen: 'termsAccepted' }],
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove agreement 1' }));

    expect('agreements' in (onChange.mock.calls.at(-1)![0] as AuthoredDocument)).toBe(false);
  });
});
