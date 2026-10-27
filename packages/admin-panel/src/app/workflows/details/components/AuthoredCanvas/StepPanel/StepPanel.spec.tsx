import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoredDocument } from '../../../utils/authored-document';
import { projectDocument } from '../../../utils/authored-projection';
import { StepPanel, type StepPanelProps } from './StepPanel';

afterEach(cleanup);

const DOC: AuthoredDocument = {
  initial: 'collect',
  steps: [
    { name: 'collect', type: 'contact-details', config: {}, edges: { completed: 'check' } },
    {
      name: 'check',
      type: 'decision',
      config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
      edges: { yes: 'done', default: 'done' },
    },
    { name: 'done', type: 'terminal', config: { status: 'approved' } },
  ],
};

const lastDoc = (onChange: ReturnType<typeof vi.fn>): AuthoredDocument =>
  onChange.mock.calls.at(-1)![0] as AuthoredDocument;

/** Holds the document the way the canvas does, so a sequence of edits accumulates. */
function Harness({
  stepName,
  initial = DOC,
  onChange,
  ...props
}: Partial<Omit<StepPanelProps, 'doc' | 'steps' | 'onChange'>> & {
  initial?: AuthoredDocument;
  onChange: (doc: AuthoredDocument) => void;
}): ReactElement {
  const [doc, setDoc] = useState(initial);
  return (
    <StepPanel
      doc={doc}
      steps={projectDocument(doc).steps}
      stepName={stepName ?? 'check'}
      readOnly={false}
      onRenamed={vi.fn()}
      onClose={vi.fn()}
      {...props}
      onChange={(next) => {
        setDoc(next);
        onChange(next);
      }}
    />
  );
}

describe('StepPanel header', () => {
  it('shows the type, its category and its description', () => {
    render(<Harness onChange={vi.fn()} />);

    expect(screen.getByText('decision')).toBeInTheDocument();
    expect(screen.getByText('decide')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Step name' })).toHaveValue('check');
  });

  it('renders nothing for a step the document does not have', () => {
    const { container } = render(<Harness stepName="missing" onChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('lists every field name of the document in the datalist', () => {
    const { container } = render(<Harness stepName="collect" onChange={vi.fn()} />);

    const options = [...container.querySelectorAll('datalist option')].map((option) =>
      option.getAttribute('value'),
    );
    expect(options).toEqual(expect.arrayContaining(['email', 'phoneNumber']));
  });
});

describe('StepPanel rename', () => {
  it('emits the renamed document, and reports the new name, on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRenamed = vi.fn();
    render(<Harness onChange={onChange} onRenamed={onRenamed} />);

    const input = screen.getByRole('textbox', { name: 'Step name' });
    await user.clear(input);
    await user.type(input, 'gate{Enter}');

    expect(lastDoc(onChange).steps.map((step) => step.name)).toEqual(['collect', 'gate', 'done']);
    expect(lastDoc(onChange).steps[0]!.edges).toEqual({ completed: 'gate' });
    expect(onRenamed).toHaveBeenCalledWith('gate');
  });

  it('shows the rename problem and does not emit an invalid name', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = screen.getByRole('textbox', { name: 'Step name' });
    await user.clear(input);
    await user.type(input, 'bad name{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('Use only letters, digits, _ and -');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a name another step already has', async () => {
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'Step name' });
    await user.clear(input);
    await user.type(input, 'done');

    expect(screen.getByRole('alert')).toHaveTextContent('done would compile two steps named done');
  });
});

describe('StepPanel actions', () => {
  it('sets the step as initial', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Set as initial' }));

    expect(lastDoc(onChange).initial).toBe('check');
  });

  it('deletes the step and closes the panel', async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<Harness onChange={onChange} onClose={onClose} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete step' }));

    expect(lastDoc(onChange).steps.map((step) => step.name)).toEqual(['collect', 'done']);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the × button', async () => {
    const onClose = vi.fn();
    render(<Harness onChange={vi.fn()} onClose={onClose} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('is read-only: no actions, a disabled port select', () => {
    render(<Harness readOnly onChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Delete step' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Target of yes' })).toBeDisabled();
  });
});

describe('StepPanel sections', () => {
  it('includes a section, and removes it again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Include a section' }));
    await user.click(await screen.findByRole('option', { name: 'consents' }));

    expect(lastDoc(onChange).steps[0]!.include?.map((section) => section.type)).toEqual([
      'consents',
    ]);
    await user.click(screen.getByRole('combobox', { name: 'Include a section' }));
    expect(await screen.findAllByRole('option')).not.toHaveLength(0);
    expect(screen.queryByRole('option', { name: 'consents' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Remove section consents' }));

    expect(lastDoc(onChange).steps[0]!.include).toBeUndefined();
  });

  it('applies config JSON, and reports invalid JSON without emitting', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Configure/ }));
    await user.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    const editor = screen.getByRole('textbox', { name: 'Config JSON' });

    fireEvent.change(editor, { target: { value: '{ nope' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: '{ "email": { "required": false } }' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(lastDoc(onChange).steps[0]!.config).toEqual({ email: { required: false } });
  });

  it('rejects config JSON that is not an object', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Configure/ }));
    await user.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Config JSON' }), {
      target: { value: '[]' },
    });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Config must be an object');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StepPanel problems', () => {
  const BROKEN: AuthoredDocument = {
    ...DOC,
    steps: [
      ...DOC.steps,
      { name: 'orphan', type: 'decision', config: { branches: 'nope' }, edges: { yes: 'ghost' } },
    ],
  };

  it('lists every issue of the selected step in full', () => {
    render(<Harness initial={BROKEN} stepName="orphan" onChange={vi.fn()} />);

    const items = within(screen.getByRole('list', { name: 'Problems' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'unreachable from the initial step',
      'invalid config: branches (Must be a list)',
      'points to missing ghost',
    ]);
  });

  it('shows the reason under the failing setting in the open form', () => {
    render(<Harness initial={BROKEN} stepName="orphan" onChange={vi.fn()} />);

    expect(screen.getByText('Must be a list')).toBeInTheDocument();
  });

  it('shows no Problems block for a step without issues', () => {
    render(<Harness initial={BROKEN} stepName="check" onChange={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: 'Problems' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Problems' })).not.toBeInTheDocument();
  });
});

describe('StepPanel field rename', () => {
  const WHEN_A = { field: 'a', isSet: true };
  const FORMS: AuthoredDocument = {
    initial: 'details',
    steps: [
      {
        name: 'details',
        type: 'form',
        config: { fields: { a: { type: 'text' }, b: { type: 'text', when: WHEN_A } } },
        edges: { completed: 'more' },
      },
      {
        name: 'more',
        type: 'form',
        config: { fields: { c: { type: 'text', when: WHEN_A } } },
        edges: { completed: 'check' },
      },
      {
        name: 'check',
        type: 'decision',
        config: { branches: [{ port: 'yes', when: WHEN_A }] },
        edges: { yes: 'done' },
      },
      { name: 'done', type: 'terminal', config: { status: 'approved' } },
    ],
  };

  async function renameA(
    initial: AuthoredDocument,
    onChange: (doc: AuthoredDocument) => void,
  ): Promise<void> {
    const user = userEvent.setup();
    render(<Harness initial={initial} stepName="details" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Configure/ }));
    const name = screen.getAllByRole('textbox', { name: 'Field name' })[0]!;
    await user.clear(name);
    await user.type(name, 'aa{Enter}');
  }

  it('renames a form field and every reference to it, as one edit', async () => {
    const onChange = vi.fn();
    await renameA(FORMS, onChange);

    expect(onChange).toHaveBeenCalledTimes(1);
    const [details, more, check] = lastDoc(onChange).steps;
    expect(Object.keys(details!.config!.fields as object)).toEqual(['aa', 'b']);
    expect(more!.config).toEqual({
      fields: { c: { type: 'text', when: { field: 'aa', isSet: true } } },
    });
    expect(check!.config).toEqual({
      branches: [{ port: 'yes', when: { field: 'aa', isSet: true } }],
    });
    expect(screen.queryByText(/References not updated/)).not.toBeInTheDocument();
  });

  it('renames only the field, with a note, when another step declares the same name', async () => {
    const onChange = vi.fn();
    const ambiguous: AuthoredDocument = {
      ...FORMS,
      steps: FORMS.steps.map((step) =>
        step.name === 'more'
          ? {
              ...step,
              config: { fields: { a: { type: 'text' }, c: { type: 'text', when: WHEN_A } } },
            }
          : step,
      ),
    };
    await renameA(ambiguous, onChange);

    expect(Object.keys(lastDoc(onChange).steps[0]!.config!.fields as object)).toEqual(['aa', 'b']);
    expect(lastDoc(onChange).steps[2]!.config).toEqual({
      branches: [{ port: 'yes', when: WHEN_A }],
    });
    expect(
      screen.getByText('References not updated: another step has a field with this name'),
    ).toBeInTheDocument();
  });
});

describe('StepPanel scoring', () => {
  const scored: AuthoredDocument = {
    scoring: { risk: { min: 0, max: 100 }, trust: { min: 0, max: 10 } },
    steps: [
      {
        name: 'collect',
        type: 'contact-details',
        config: {},
        scoring: [{ score: 'risk', add: 5 }],
        edges: { completed: 'done' },
      },
      { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
    ],
  };
  const scoringOf = (onChange: ReturnType<typeof vi.fn>): unknown =>
    lastDoc(onChange).steps[0]?.scoring;

  it('points to Workflow settings while no score is declared', () => {
    render(
      <Harness
        stepName="collect"
        initial={{ steps: [{ name: 'collect', type: 'contact-details', config: {} }] }}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Declare a score in Workflow settings to score this step.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add rule' })).not.toBeInTheDocument();
  });

  it('is left out on a terminal step and on a risk-score step', () => {
    const { unmount } = render(<Harness stepName="done" initial={scored} onChange={vi.fn()} />);

    expect(screen.queryByRole('heading', { name: 'Scoring' })).not.toBeInTheDocument();
    unmount();

    render(
      <Harness
        stepName="risk"
        initial={{
          ...scored,
          steps: [{ name: 'risk', type: 'risk-score', config: { rules: [], bands: [] } }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Scoring' })).not.toBeInTheDocument();
  });

  it('shows the section on a step with no rules and adds one on the first declared score', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        stepName="collect"
        initial={{ ...scored, steps: [{ ...scored.steps[0]!, scoring: undefined }] }}
        onChange={onChange}
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: '+ Add rule' }));

    expect(scoringOf(onChange)).toEqual([{ score: 'risk', add: 1 }]);
  });

  it('edits the score, the points, and a condition of a rule', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={scored} onChange={onChange} />);
    const rule = within(screen.getByRole('group', { name: 'Rule 1' }));

    await user.click(rule.getByRole('combobox', { name: 'Score of rule 1' }));
    await user.click(await screen.findByRole('option', { name: 'trust' }));
    expect(scoringOf(onChange)).toEqual([{ score: 'trust', add: 5 }]);

    await user.clear(rule.getByRole('spinbutton', { name: 'Points of rule 1' }));
    await user.type(rule.getByRole('spinbutton', { name: 'Points of rule 1' }), '-3');
    expect(scoringOf(onChange)).toEqual([{ score: 'trust', add: -3 }]);

    await user.click(rule.getByRole('button', { name: 'Add condition to rule 1' }));
    expect(scoringOf(onChange)).toEqual([
      { score: 'trust', add: -3, when: { field: '', isSet: true } },
    ]);

    await user.click(rule.getByRole('button', { name: 'Remove condition of rule 1' }));
    expect(scoringOf(onChange)).toEqual([{ score: 'trust', add: -3 }]);
  });

  it('keeps zero out of the document and says why', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={scored} onChange={onChange} />);
    const points = screen.getByRole('spinbutton', { name: 'Points of rule 1' });

    await user.clear(points);
    await user.type(points, '0');

    expect(points).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Points must be a whole number, not 0.');
    expect(onChange.mock.calls.every(([doc]) => doc.steps[0]?.scoring?.[0]?.add !== 0)).toBe(true);
  });

  it('offers no score leaf in a rule condition', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        stepName="collect"
        initial={{
          ...scored,
          steps: [
            {
              ...scored.steps[0]!,
              scoring: [{ score: 'risk', add: 5, when: { field: 'email', isSet: true } }],
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Condition type' }));

    expect(await screen.findByRole('option', { name: 'Field' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Score' })).not.toBeInTheDocument();
  });

  it('removes a rule, and the scoring key with the last one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={scored} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));

    expect('scoring' in lastDoc(onChange).steps[0]!).toBe(false);
  });

  it('shows a rule whose score is no longer declared, flagged, with the problem listed', () => {
    render(
      <Harness
        stepName="collect"
        initial={{ ...scored, scoring: { trust: { min: 0, max: 10 } } }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Score of rule 1' })).toHaveTextContent(
      'risk (not declared)',
    );
    expect(
      within(screen.getByRole('list', { name: 'Problems' })).getByText(
        'scoring names undeclared score: risk',
      ),
    ).toBeInTheDocument();
  });

  it('is read-only without edit controls', () => {
    render(<Harness stepName="collect" initial={scored} readOnly onChange={vi.fn()} />);

    expect(screen.getByRole('spinbutton', { name: 'Points of rule 1' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove rule 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add rule' })).not.toBeInTheDocument();
  });
});

describe('StepPanel scoring on a custom step', () => {
  const custom: AuthoredDocument = {
    scoring: { risk: { min: 0, max: 100 }, trust: { min: 0, max: 10 } },
    steps: [
      {
        name: 'collect',
        type: 'custom',
        config: {
          status: 'awaiting_user',
          scoring: [
            { score: 'risk', add: 5 },
            { score: 'trust', add: 2 },
          ],
          transitions: [],
        },
        scoring: [{ score: 'trust', add: 1 }],
      },
    ],
  };
  const configRules = (onChange: ReturnType<typeof vi.fn>): unknown =>
    lastDoc(onChange).steps[0]?.config?.scoring;

  it('lists the config rules, then the step-level ones', () => {
    render(<Harness stepName="collect" initial={custom} onChange={vi.fn()} />);

    expect(screen.getByText('3 rules')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Points of rule 1' })).toHaveValue(5);
    expect(screen.getByRole('spinbutton', { name: 'Points of rule 2' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Points of rule 3' })).toHaveValue(1);
  });

  it('writes an edit to the list the rule came from', async () => {
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={custom} onChange={onChange} />);

    await userEvent.setup().type(screen.getByRole('spinbutton', { name: 'Points of rule 2' }), '0');
    expect(configRules(onChange)).toEqual([
      { score: 'risk', add: 5 },
      { score: 'trust', add: 20 },
    ]);
    expect(lastDoc(onChange).steps[0]?.scoring).toEqual([{ score: 'trust', add: 1 }]);

    await userEvent.setup().type(screen.getByRole('spinbutton', { name: 'Points of rule 3' }), '0');
    expect(lastDoc(onChange).steps[0]?.scoring).toEqual([{ score: 'trust', add: 10 }]);
  });

  it('adds a new rule to config.scoring', async () => {
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={custom} onChange={onChange} />);

    await userEvent.setup().click(screen.getByRole('button', { name: '+ Add rule' }));

    expect(configRules(onChange)).toHaveLength(3);
    expect(lastDoc(onChange).steps[0]?.scoring).toHaveLength(1);
  });

  it('does not carry a points draft over to the rule that takes its place', async () => {
    const user = userEvent.setup();
    render(<Harness stepName="collect" initial={custom} onChange={vi.fn()} />);

    await user.clear(screen.getByRole('spinbutton', { name: 'Points of rule 1' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('spinbutton', { name: 'Points of rule 1' })).toHaveValue(2);
  });

  it('drops config.scoring with its last rule and keeps the other config', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness stepName="collect" initial={custom} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove rule 1' }));

    const config = lastDoc(onChange).steps[0]?.config;
    expect('scoring' in config!).toBe(false);
    expect(config?.status).toBe('awaiting_user');
    expect(lastDoc(onChange).steps[0]?.scoring).toEqual([{ score: 'trust', add: 1 }]);
  });

  it('leaves scoring out of the settings form', async () => {
    const user = userEvent.setup();
    render(<Harness stepName="collect" initial={custom} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Configure/ }));
    const more = screen.queryByRole('button', { name: /Show \d+ more settings?/ });
    if (more) await user.click(more);
    expect(screen.queryByText('Scoring', { selector: 'label, span, legend' })).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Scoring' })).toHaveLength(1);
  });
});
