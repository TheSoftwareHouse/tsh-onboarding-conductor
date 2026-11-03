import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoredDocument } from '../../../utils/authored-document';
import { projectDocument } from '../../../utils/authored-projection';
import { PortArms } from './PortArms';
import { StepPanel } from './StepPanel';

afterEach(cleanup);

const STEP_NAMES = ['check', 'done', 'other'];

function renderArms(props: Partial<Parameters<typeof PortArms>[0]> = {}): {
  onWire: ReturnType<typeof vi.fn>;
  onArms: ReturnType<typeof vi.fn>;
} {
  const onWire = vi.fn();
  const onArms = vi.fn();
  render(
    <PortArms
      label="yes"
      portName="yes"
      arms={[]}
      stepNames={STEP_NAMES}
      readOnly={false}
      onWire={onWire}
      onArms={onArms}
      {...props}
    />,
  );
  return { onWire, onArms };
}

describe('PortArms plain port', () => {
  it('wires the port to the chosen step', async () => {
    const user = userEvent.setup();
    const { onWire } = renderArms();

    await user.click(screen.getByRole('combobox', { name: 'Target of yes' }));
    await user.click(await screen.findByRole('option', { name: 'done' }));

    expect(onWire).toHaveBeenCalledWith('done');
  });

  it('unwires the port when "Not wired" is chosen', async () => {
    const user = userEvent.setup();
    const { onWire } = renderArms({ arms: [{ target: 'done' }] });

    await user.click(screen.getByRole('combobox', { name: 'Target of yes' }));
    await user.click(await screen.findByRole('option', { name: 'Not wired' }));

    expect(onWire).toHaveBeenCalledWith(null);
  });

  it('starts a branch with a condition above the existing target', async () => {
    const { onArms } = renderArms({ arms: [{ target: 'done' }] });

    await userEvent.setup().click(screen.getByRole('button', { name: '+ Add condition' }));

    const [arms] = onArms.mock.calls[0]!;
    expect(arms).toHaveLength(2);
    expect(arms[0]).toMatchObject({ target: '' });
    expect(arms[0].when).toBeDefined();
    expect(arms[1]).toEqual({ target: 'done' });
  });
});

describe('PortArms branched port', () => {
  const arms = [
    { when: { field: 'x', isSet: true }, target: 'done' },
    { when: { field: 'y', isSet: true }, target: 'other' },
    { target: 'check' },
  ];

  it('keeps the fallback last when a condition moves', async () => {
    const { onArms } = renderArms({ arms });

    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Move condition down' })[0]!);

    expect(onArms.mock.calls[0]![0].map((arm: { target: string }) => arm.target)).toEqual([
      'other',
      'done',
      'check',
    ]);
  });

  it('retargets one condition', async () => {
    const user = userEvent.setup();
    const { onArms } = renderArms({ arms });

    await user.click(screen.getByRole('combobox', { name: 'Target of yes condition 1' }));
    await user.click(await screen.findByRole('option', { name: 'other' }));

    expect(onArms.mock.calls[0]![0][0]).toMatchObject({ target: 'other' });
  });

  it('removes the fallback when "No fallback" is chosen', async () => {
    const user = userEvent.setup();
    const { onArms } = renderArms({ arms });

    await user.click(screen.getByRole('combobox', { name: 'Fallback target of yes' }));
    await user.click(await screen.findByRole('option', { name: 'No fallback' }));

    expect(onArms.mock.calls[0]![0]).toHaveLength(2);
  });
});

describe('StepPanel port wiring', () => {
  const DOC: AuthoredDocument = {
    steps: [
      {
        name: 'check',
        type: 'decision',
        config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
        edges: { yes: 'done' },
      },
      { name: 'done', type: 'terminal', config: { status: 'approved' } },
    ],
  };

  it('choosing a target wires the port, with no drag', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StepPanel
        doc={DOC}
        steps={projectDocument(DOC).steps}
        stepName="check"
        readOnly={false}
        onChange={onChange}
        onRenamed={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Target of default' }));
    await user.click(await screen.findByRole('option', { name: 'done' }));

    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).steps[0]!.edges).toEqual({
      yes: 'done',
      default: 'done',
    });
  });

  it('clearing the target unwires the port', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StepPanel
        doc={DOC}
        steps={projectDocument(DOC).steps}
        stepName="check"
        readOnly={false}
        onChange={onChange}
        onRenamed={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Target of yes' }));
    await user.click(await screen.findByRole('option', { name: 'Not wired' }));

    expect((onChange.mock.calls.at(-1)![0] as AuthoredDocument).steps[0]!.edges).toEqual({});
  });
});
