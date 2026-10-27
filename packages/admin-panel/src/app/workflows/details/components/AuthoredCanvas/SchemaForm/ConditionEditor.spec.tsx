import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConditionEditor } from './ConditionEditor';

afterEach(() => {
  cleanup();
});

function renderEditor(value: unknown, readOnly = false): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<ConditionEditor value={value} onChange={onChange} readOnly={readOnly} />);
  return onChange;
}

describe('ConditionEditor', () => {
  it('reads a stored comparison into field, operator and value', () => {
    renderEditor({ not: { field: 'country', equals: 'PL' } });

    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue('country');
    expect(screen.getByRole('combobox', { name: 'Operator' })).toHaveTextContent('does not equal');
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('PL');
  });

  it('writes an edited value back to the engine grammar once the value loses focus', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'country', equals: 'P' });

    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'L');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith({ field: 'country', equals: 'PL' });
  });

  it('keeps a decimal whole while it is typed', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'income', equals: '' });

    await user.type(screen.getByRole('textbox', { name: 'Value' }), '1.5');
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('1.5');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith({ field: 'income', equals: 1.5 });
  });

  it('keeps a leading-zero code as text', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'postcode', equals: '' });

    await user.type(screen.getByRole('textbox', { name: 'Value' }), '01234');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith({ field: 'postcode', equals: '01234' });
  });

  it('leaves a stored text value alone when it is only focused and left', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'code', equals: '10' });

    await user.click(screen.getByRole('textbox', { name: 'Value' }));
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('wraps a negated operator in not', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'country', equals: 'PL' });

    await user.click(screen.getByRole('combobox', { name: 'Operator' }));
    await user.click(await screen.findByRole('option', { name: 'does not equal' }));

    expect(onChange).toHaveBeenLastCalledWith({ not: { field: 'country', equals: 'PL' } });
  });

  it('turns a comma-separated list into an in condition with typed members', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'age', in: [] });

    await user.type(screen.getByRole('textbox', { name: 'Value' }), '1, PL');
    await user.tab();

    expect(onChange).toHaveBeenLastCalledWith({ field: 'age', in: [1, 'PL'] });
  });

  it.each([
    ['equals', { field: 'country', equals: '' }],
    ['does not equal', { not: { field: 'country', equals: '' } }],
  ])('drops a list of several values when the operator becomes %s', async (option, expected) => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'country', in: ['PL', 'DE'] });

    await user.click(screen.getByRole('combobox', { name: 'Operator' }));
    await user.click(await screen.findByRole('option', { name: option }));

    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it('keeps the one value of a single-item list when the operator becomes equals', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'country', in: ['PL'] });

    await user.click(screen.getByRole('combobox', { name: 'Operator' }));
    await user.click(await screen.findByRole('option', { name: 'equals' }));

    expect(onChange).toHaveBeenLastCalledWith({ field: 'country', equals: 'PL' });
  });

  it('hides the value for an is-set operator', () => {
    renderEditor({ field: 'country', isSet: true });

    expect(screen.queryByRole('textbox', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('switches the subject to a group seeded with the current field', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({ field: 'country', equals: 'PL' });

    await user.click(screen.getByRole('combobox', { name: 'Condition type' }));
    await user.click(await screen.findByRole('option', { name: 'All of' }));

    expect(onChange).toHaveBeenLastCalledWith({ all: [{ field: 'country', isSet: true }] });
  });

  it.each([
    [
      'Any of',
      {
        any: [
          { field: 'a', isSet: true },
          { field: 'b', equals: 1 },
        ],
      },
    ],
    [
      'None of',
      {
        not: {
          any: [
            { field: 'a', isSet: true },
            { field: 'b', equals: 1 },
          ],
        },
      },
    ],
  ])('keeps the rows when a group becomes %s', async (option, expected) => {
    const user = userEvent.setup();
    const onChange = renderEditor({
      all: [
        { field: 'a', isSet: true },
        { field: 'b', equals: 1 },
      ],
    });

    await user.click(screen.getAllByRole('combobox', { name: 'Condition type' })[0]!);
    await user.click(await screen.findByRole('option', { name: option }));

    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it('edits a score threshold', async () => {
    const onChange = renderEditor({ score: 'risk', gte: 1 });

    await userEvent.setup().type(screen.getByRole('spinbutton', { name: 'Threshold' }), '0');

    expect(onChange).toHaveBeenLastCalledWith({ score: 'risk', gte: 10 });
  });

  it('lets the threshold be cleared and typed negative, without snapping to 0', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Held(): ReactElement {
      const [value, setValue] = useState<unknown>({ score: 'risk', gte: 1 });
      return (
        <ConditionEditor
          value={value}
          readOnly={false}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }
    render(<Held />);
    const box = screen.getByRole('spinbutton', { name: 'Threshold' });

    await user.clear(box);
    expect(onChange).toHaveBeenLastCalledWith({ score: 'risk', gte: undefined });
    expect(box).toHaveValue(null);

    await user.type(box, '-5');
    expect(onChange).toHaveBeenLastCalledWith({ score: 'risk', gte: -5 });
  });

  it('adds and removes rows of a group', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor({
      any: [
        { field: 'a', isSet: true },
        { field: 'b', isSet: true },
      ],
    });

    await user.click(screen.getByRole('button', { name: '+ Add condition' }));
    expect(onChange).toHaveBeenLastCalledWith({
      any: [
        { field: 'a', isSet: true },
        { field: 'b', isSet: true },
        { field: '', isSet: true },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    expect(onChange).toHaveBeenLastCalledWith({ any: [{ field: 'b', isSet: true }] });
  });

  it('disables the controls when read-only', () => {
    renderEditor({ field: 'country', equals: 'PL' }, true);

    expect(screen.getByRole('combobox', { name: 'Field' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Operator' })).toHaveAttribute('data-disabled');
  });

  it('offers no Score subject when scores are not allowed', async () => {
    const user = userEvent.setup();
    render(
      <ConditionEditor
        value={{ field: 'a', isSet: true }}
        onChange={vi.fn()}
        readOnly={false}
        allowScore={false}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Condition type' }));

    expect(await screen.findByRole('option', { name: 'Field' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Score' })).not.toBeInTheDocument();
  });
});
