import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '../../../utils/config-schema';
import { ConfigFormContext } from './config-form-context';
import { SchemaForm, type SchemaFormProps } from './SchemaForm';

afterEach(() => {
  cleanup();
});

/** Holds the value the way the document does, so a sequence of edits accumulates. */
function Harness({
  initial,
  onChange,
  ...props
}: Omit<SchemaFormProps, 'value' | 'onChange' | 'readOnly'> & {
  initial?: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      readOnly={false}
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const lastCall = (spy: ReturnType<typeof vi.fn>): unknown => spy.mock.calls.at(-1)?.[0];

describe('SchemaForm scalars', () => {
  it('emits a string as typed', async () => {
    const onChange = vi.fn();
    render(<Harness schema={{ type: 'string' }} label="Name" onChange={onChange} initial="" />);

    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Name' }), 'ab');

    expect(lastCall(onChange)).toBe('ab');
  });

  it('emits a number, and unsets it when cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness schema={{ type: 'integer' }} label="Retries" onChange={onChange} initial={1} />,
    );

    const input = screen.getByRole('spinbutton', { name: 'Retries' });
    await user.type(input, '2');
    expect(lastCall(onChange)).toBe(12);

    await user.clear(input);
    expect(lastCall(onChange)).toBeUndefined();
  });

  it('emits the chosen enum option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ enum: ['passport', 'idCard'] }}
        label="Document"
        onChange={onChange}
        initial="passport"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Document' }));
    await user.click(await screen.findByRole('option', { name: 'idCard' }));

    expect(lastCall(onChange)).toBe('idCard');
  });

  it('unsets an optional enum through its placeholder option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ enum: ['a', 'b'] }}
        label="Mode"
        optional
        fallback="a"
        onChange={onChange}
        initial="b"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Mode' }));
    await user.click(await screen.findByRole('option', { name: 'Not set (default: a)' }));

    expect(lastCall(onChange)).toBeUndefined();
  });

  it('emits an optional boolean as yes, no or unset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={{ type: 'boolean' }} label="Strict" optional onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Strict' }));
    await user.click(await screen.findByRole('option', { name: 'yes' }));

    expect(lastCall(onChange)).toBe(true);
  });

  it('emits a required boolean from its checkbox', async () => {
    const onChange = vi.fn();
    render(
      <Harness schema={{ type: 'boolean' }} label="Strict" onChange={onChange} initial={false} />,
    );

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Strict' }));

    expect(lastCall(onChange)).toBe(true);
  });

  it('keeps a free-form string that reads as JSON a string when left untouched', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={{}} label="Value" onChange={onChange} initial="2" />);

    await user.click(screen.getByRole('textbox', { name: 'Value' }));
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('parses an edited free-form value as JSON', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={{}} label="Value" onChange={onChange} initial="2" />);

    await user.type(screen.getByRole('textbox', { name: 'Value' }), '0');
    await user.tab();

    expect(lastCall(onChange)).toBe(20);
  });

  it('disables every control when read-only', () => {
    render(
      <SchemaForm schema={{ type: 'string' }} label="Name" value="x" readOnly onChange={vi.fn()} />,
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled();
  });
});

describe('SchemaForm lists and maps', () => {
  const tags: Schema = { type: 'array', items: { type: 'string' } };

  it('adds, edits and removes array entries', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={tags} label="Tags" onChange={onChange} initial={[]} />);

    await user.click(screen.getByRole('button', { name: '+ Add tag' }));
    expect(lastCall(onChange)).toEqual(['']);

    await user.type(screen.getByRole('textbox', { name: 'Tags 1' }), 'x');
    expect(lastCall(onChange)).toEqual(['x']);

    await user.click(screen.getByRole('button', { name: 'Remove Tags 1' }));
    expect(lastCall(onChange)).toEqual([]);
  });

  it('toggles the options of a closed set', async () => {
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ type: 'array', items: { enum: ['sms', 'email'] } }}
        label="Channels"
        onChange={onChange}
        initial={['sms']}
      />,
    );

    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'email' }));

    expect(lastCall(onChange)).toEqual(['sms', 'email']);
  });

  it('adds a map entry under a new key and edits its value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ type: 'object', additionalProperties: { type: 'string' } }}
        name="labels"
        onChange={onChange}
        initial={{}}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'New name' }), 'greeting');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(lastCall(onChange)).toEqual({ greeting: '' });

    await user.type(screen.getByRole('textbox', { name: 'greeting value' }), 'hi');
    expect(lastCall(onChange)).toEqual({ greeting: 'hi' });
  });
});

describe('SchemaForm map entry names', () => {
  const schema: Schema = { type: 'object', additionalProperties: { type: 'string' } };
  const initial = { a: '1', b: '2', c: '3' };

  it.each([
    ['a', '“a” is already used'],
    ['constructor', '“constructor” is a reserved name'],
    ['__proto__', '“__proto__” is a reserved name'],
  ])('refuses to add %s and says why', async (key, message) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    await user.type(screen.getByRole('textbox', { name: 'New name' }), key);
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('refuses to add a name the map pattern does not allow', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const patterned: Schema & { propertyNames: Schema } = {
      ...schema,
      propertyNames: { pattern: '^[a-z]+$' },
    };
    render(<Harness schema={patterned} name="labels" onChange={onChange} initial={{}} />);

    await user.type(screen.getByRole('textbox', { name: 'New name' }), 'Bad1');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Name must match ^[a-z]+$');
  });

  it('renames an entry on Enter, keeping its order and value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    const names = screen.getAllByRole('textbox', { name: 'Name' });
    await user.clear(names[1]);
    await user.type(names[1], 'beta{Enter}');

    const next = lastCall(onChange) as Record<string, string>;
    expect(Object.entries(next)).toEqual([
      ['a', '1'],
      ['beta', '2'],
      ['c', '3'],
    ]);
  });

  it('renames on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    const first = screen.getAllByRole('textbox', { name: 'Name' })[0];
    await user.type(first, 'x');
    await user.tab();

    expect(Object.keys(lastCall(onChange) as object)).toEqual(['ax', 'b', 'c']);
  });

  it('refuses a duplicate name with a message and emits nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    const first = screen.getAllByRole('textbox', { name: 'Name' })[0];
    await user.clear(first);
    await user.type(first, 'b{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('“b” is already used');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses an empty name with a message and emits nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    await user.clear(screen.getAllByRole('textbox', { name: 'Name' })[0]);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a name failing the propertyNames pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ ...schema, propertyNames: { pattern: '^[a-z]+$' } } as Schema}
        name="labels"
        onChange={onChange}
        initial={initial}
      />,
    );

    await user.type(screen.getAllByRole('textbox', { name: 'Name' })[0], '9{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('must match ^[a-z]+$');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores the old name on Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} name="labels" onChange={onChange} initial={initial} />);

    const first = screen.getAllByRole('textbox', { name: 'Name' })[0];
    await user.type(first, 'zzz{Escape}');

    expect(first).toHaveValue('a');
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels the name "Field name" for a fields map', () => {
    render(<Harness schema={schema} name="fields" onChange={vi.fn()} initial={{ test: '' }} />);

    expect(screen.getByRole('textbox', { name: 'Field name' })).toHaveValue('test');
    expect(screen.getByRole('textbox', { name: 'New field name' })).toBeInTheDocument();
  });
});

describe('SchemaForm objects', () => {
  const schema: Schema = {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: { type: 'string' },
      note: { type: 'string' },
      limits: {
        type: 'object',
        properties: { maxTries: { type: 'integer' } },
      },
    },
  };

  it('hides unset optional settings at the top level and reveals them on request', async () => {
    const user = userEvent.setup();
    render(
      <SchemaForm
        schema={schema}
        value={{ kind: 'a' }}
        readOnly={false}
        hidesUnset
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Kind' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 2 more settings' }));

    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument();
  });

  it('keeps a shown optional setting in place when it is cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness schema={schema} hidesUnset initial={{ kind: 'a', note: 'x' }} onChange={onChange} />,
    );

    await user.clear(screen.getByRole('textbox', { name: 'Note' }));
    expect(lastCall(onChange)).toEqual({ kind: 'a' });
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus();

    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'y');
    expect(lastCall(onChange)).toEqual({ kind: 'a', note: 'y' });
  });

  it('shows unset nested settings, since only the top level hides them', () => {
    render(
      <SchemaForm
        schema={schema}
        value={{ kind: 'a', limits: {} }}
        readOnly={false}
        hidesUnset
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('spinbutton', { name: 'Max tries' })).toBeInTheDocument();
  });

  it('shows every member without hidesUnset', () => {
    render(
      <SchemaForm schema={schema} value={{ kind: 'a' }} readOnly={false} onChange={vi.fn()} />,
    );

    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument();
  });

  it('starts an unset object from its defaults and drops a cleared member', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness schema={schema} onChange={onChange} initial={{ kind: 'a', note: 'n' }} />);

    await user.clear(screen.getByRole('textbox', { name: 'Note' }));
    expect(lastCall(onChange)).toEqual({ kind: 'a' });

    await user.click(screen.getByRole('button', { name: 'Set Limits' }));
    expect(lastCall(onChange)).toEqual({ kind: 'a', limits: {} });
  });
});

describe('SchemaForm variants', () => {
  it('switches a text-or-list value to the other shape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness
        schema={{ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }}
        label="Allowed"
        onChange={onChange}
        initial="x"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Allowed' })).toHaveValue('x');
    await user.click(screen.getByRole('button', { name: 'list' }));

    expect(lastCall(onChange)).toEqual([]);
    expect(screen.getByRole('button', { name: '+ Add allowed' })).toBeInTheDocument();
  });

  it('switches a tagged object by its type, keeping the tag', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: Schema = {
      anyOf: [
        {
          type: 'object',
          required: ['type', 'name'],
          properties: { type: { const: 'text' }, name: { type: 'string' } },
        },
        {
          type: 'object',
          required: ['type', 'size'],
          properties: { type: { const: 'file' }, size: { type: 'integer' } },
        },
      ],
    };
    render(
      <Harness
        schema={schema}
        label="Field"
        onChange={onChange}
        initial={{ type: 'text', name: 'a' }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Field type' }));
    await user.click(await screen.findByRole('option', { name: 'file' }));

    expect(lastCall(onChange)).toEqual({ type: 'file', size: 0 });
    expect(screen.getByRole('spinbutton', { name: 'Size' })).toBeInTheDocument();
  });
});

describe('SchemaForm failures', () => {
  const schema: Schema = {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      retries: { type: 'integer' },
      docs: { type: 'array', items: { type: 'string' } },
    },
  };

  function renderWithFailures(failures: Record<string, string>): void {
    render(
      <ConfigFormContext.Provider value={{ stepType: null, renameField: null, failures }}>
        <SchemaForm
          schema={schema}
          value={{ url: '', retries: 5, docs: ['a', 'b'] }}
          readOnly={false}
          onChange={vi.fn()}
        />
      </ConfigFormContext.Provider>,
    );
  }

  it('shows the reason under the failing setting and links it to the control', () => {
    renderWithFailures({ url: 'Required', retries: 'Must be 100–30000' });

    const url = screen.getByRole('textbox', { name: 'URL' });
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('Required');
    expect(screen.getByRole('spinbutton', { name: 'Retries' })).toHaveAccessibleDescription(
      'Must be 100–30000',
    );
  });

  it('shows the reason of one list entry only under that entry', () => {
    renderWithFailures({ 'docs[1]': 'Must not be empty' });

    expect(screen.getByRole('textbox', { name: 'Docs 2' })).toHaveAccessibleDescription(
      'Must not be empty',
    );
    expect(screen.getByRole('textbox', { name: 'Docs 1' })).not.toHaveAttribute('aria-invalid');
  });

  it('shows no reason for a setting that passes', () => {
    renderWithFailures({ url: 'Required' });

    expect(screen.getByRole('spinbutton', { name: 'Retries' })).not.toHaveAttribute('aria-invalid');
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });

  it('shows the reason of an untagged variant once', () => {
    render(
      <ConfigFormContext.Provider
        value={{ stepType: null, renameField: null, failures: { body: 'Not valid' } }}
      >
        <SchemaForm
          schema={{ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }}
          path="body"
          label="Body"
          value="x"
          readOnly={false}
          onChange={vi.fn()}
        />
      </ConfigFormContext.Provider>,
    );

    expect(screen.getAllByText('Not valid')).toHaveLength(1);
  });
});
