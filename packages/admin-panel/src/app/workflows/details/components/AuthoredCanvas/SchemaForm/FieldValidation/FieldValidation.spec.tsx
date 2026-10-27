import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaForm } from '../SchemaForm';
import { BYTES_PER_MEGABYTE } from './validation-values';

afterEach(() => {
  cleanup();
});

const FILE_VALIDATION_SCHEMA = {
  type: 'object',
  properties: { contentTypes: { type: 'array' }, maxSizeBytes: { type: 'integer' } },
};

/** Holds the value the way the document does, so a sequence of edits accumulates. */
function Harness({
  schema,
  initial,
  onChange,
}: {
  schema: object;
  initial: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      schema={schema}
      name="validation"
      label="Validation"
      readOnly={false}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const lastCall = (spy: ReturnType<typeof vi.fn>): unknown => spy.mock.calls.at(-1)?.[0];

async function choose(select: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('boolean validation', () => {
  it('writes oneOf for each option and removes it for "Any value"', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ $ref: '#/definitions/booleanValidation' }}
        initial={{}}
        onChange={onChange}
      />,
    );

    await choose('Allowed value', 'Must be true');
    expect(lastCall(onChange)).toEqual({ oneOf: [true] });

    await choose('Allowed value', 'Must be false');
    expect(lastCall(onChange)).toEqual({ oneOf: [false] });

    await choose('Allowed value', 'Any value');
    expect(lastCall(onChange)).toEqual({});
  });
});

describe('text validation', () => {
  const schema = { $ref: '#/definitions/textValidation' };

  it('moves the list between oneOf and manyOf and clears both for "Any value"', async () => {
    const onChange = vi.fn();
    render(<Harness schema={schema} initial={{ oneOf: ['a', 'b'] }} onChange={onChange} />);

    await choose('Allowed values', 'Pick several of');
    expect(lastCall(onChange)).toEqual({ manyOf: ['a', 'b'] });

    await choose('Allowed values', 'Pick one of');
    expect(lastCall(onChange)).toEqual({ oneOf: ['a', 'b'] });

    await choose('Allowed values', 'Any value');
    expect(lastCall(onChange)).toEqual({});
  });

  it('shows the message for a pattern that is not a regular expression', async () => {
    const user = userEvent.setup();
    render(<Harness schema={schema} initial={{}} onChange={vi.fn()} />);

    expect(screen.queryByText('Not a valid pattern')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Pattern' }), '[[');

    expect(screen.getByText('Not a valid pattern')).toBeInTheDocument();
  });

  it('offers the formats the schema declares and writes the chosen one', async () => {
    const onChange = vi.fn();
    render(<Harness schema={schema} initial={{}} onChange={onChange} />);

    await choose('Format', 'email');

    expect(lastCall(onChange)).toEqual({ format: 'email' });
  });

  it('writes a length and unsets it when cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} initial={{}} onChange={onChange} />);

    const input = screen.getByRole('spinbutton', { name: 'Minimum length' });
    await user.type(input, '3');
    expect(lastCall(onChange)).toEqual({ minLength: 3 });

    await user.clear(input);
    expect(lastCall(onChange)).toEqual({});
  });
});

describe('number validation', () => {
  it('swaps minimum and exclusiveMinimum with the inclusive checkbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ $ref: '#/definitions/numberValidation' }}
        initial={{ minimum: 5 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Minimum inclusive' }));
    expect(lastCall(onChange)).toEqual({ exclusiveMinimum: 5 });

    await user.click(screen.getByRole('checkbox', { name: 'Minimum inclusive' }));
    expect(lastCall(onChange)).toEqual({ minimum: 5 });
  });

  it('lets an allowed value be cleared and typed negative, without snapping to 0', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ $ref: '#/definitions/numberValidation' }}
        initial={{ oneOf: [7] }}
        onChange={onChange}
      />,
    );
    const box = screen.getByRole('spinbutton', { name: 'Allowed value 1' });

    await user.clear(box);
    expect(lastCall(onChange)).toEqual({ oneOf: [null] });
    expect(box).toHaveValue(null);

    await user.type(box, '-5');
    expect(lastCall(onChange)).toEqual({ oneOf: [-5] });
  });
});

describe('date validation', () => {
  it('writes the age bounds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ $ref: '#/definitions/dateValidation' }}
        initial={{}}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('spinbutton', { name: 'Minimum age (years)' }), '18');

    expect(lastCall(onChange)).toEqual({ minAgeYears: 18 });
  });
});

describe('array validation', () => {
  it('writes the item bounds', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ $ref: '#/definitions/arrayValidation' }}
        initial={{}}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('spinbutton', { name: 'Maximum items' }), '4');

    expect(lastCall(onChange)).toEqual({ maxItems: 4 });
  });
});

describe('file validation', () => {
  it('stores the maximum size entered in MB as bytes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['application/pdf'] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('spinbutton', { name: 'Maximum size (MB)' }), '2');

    expect(lastCall(onChange)).toEqual({
      contentTypes: ['application/pdf'],
      maxSizeBytes: 2 * BYTES_PER_MEGABYTE,
    });
  });

  it('shows image dimensions only while every content type is an image', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['image/png'], maxImageWidth: 100 }}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole('spinbutton', { name: 'Maximum image width (px)' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add content type' }));
    await user.type(screen.getByRole('textbox', { name: 'Content type 2' }), 'application/pdf');
    await user.tab();

    expect(
      screen.queryByRole('spinbutton', { name: 'Maximum image width (px)' }),
    ).not.toBeInTheDocument();
    expect(lastCall(onChange)).toEqual({ contentTypes: ['image/png', 'application/pdf'] });
  });

  it('keeps the image dimensions while an image content type is typed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['image/png'], maxImageWidth: 100, maxImageHeight: 50 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add content type' }));
    await user.type(screen.getByRole('textbox', { name: 'Content type 2' }), 'image/webp');
    await user.tab();

    expect(lastCall(onChange)).toEqual({
      contentTypes: ['image/png', 'image/webp'],
      maxImageWidth: 100,
      maxImageHeight: 50,
    });
    expect(screen.getByRole('spinbutton', { name: 'Maximum image width (px)' })).toHaveValue(100);
  });

  it('drops the image dimensions when the only image content type is removed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['image/png', 'application/pdf'], maxImageWidth: 100 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove content type 1' }));

    expect(lastCall(onChange)).toEqual({ contentTypes: ['application/pdf'] });
  });

  it('shows a fractional size in MB as typed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['application/pdf'] }}
        onChange={onChange}
      />,
    );
    const size = screen.getByRole('spinbutton', { name: 'Maximum size (MB)' });

    await user.type(size, '1.25');

    expect(size).toHaveValue(1.25);
    expect(lastCall(onChange)).toEqual({
      contentTypes: ['application/pdf'],
      maxSizeBytes: Math.round(1.25 * BYTES_PER_MEGABYTE),
    });
  });

  it('keeps the image dimensions when an empty content type is added', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['image/png'], maxImageWidth: 100, maxImageHeight: 50 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add content type' }));

    expect(lastCall(onChange)).toEqual({
      contentTypes: ['image/png', ''],
      maxImageWidth: 100,
      maxImageHeight: 50,
    });
    expect(screen.getByRole('spinbutton', { name: 'Maximum image width (px)' })).toHaveValue(100);
  });
});

const CONTROL_ROLES = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'button'];

function listControls(): HTMLElement[] {
  return CONTROL_ROLES.flatMap((role) => screen.queryAllByRole(role));
}

describe('every control has an accessible name', () => {
  it.each([
    ['text', { oneOf: ['a'] }],
    ['number', { manyOf: [1], minimum: 1 }],
    ['date', { oneOf: ['2020-01-01'] }],
    ['boolean', {}],
    ['array', {}],
  ])('%s', (type, initial) => {
    render(
      <Harness
        schema={{ $ref: `#/definitions/${type}Validation` }}
        initial={initial}
        onChange={vi.fn()}
      />,
    );

    const controls = listControls();
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control).toHaveAccessibleName();
  });

  it('file', () => {
    render(
      <Harness
        schema={FILE_VALIDATION_SCHEMA}
        initial={{ contentTypes: ['image/png', 'image/jpeg'] }}
        onChange={vi.fn()}
      />,
    );

    for (const control of listControls()) expect(control).toHaveAccessibleName();
  });
});
