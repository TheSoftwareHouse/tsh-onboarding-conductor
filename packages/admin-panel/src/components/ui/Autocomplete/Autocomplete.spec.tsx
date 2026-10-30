import '@testing-library/jest-dom/vitest';
import { useState, type ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Autocomplete } from './Autocomplete';

afterEach(() => {
  cleanup();
});

const ITEMS = [{ value: 'email', description: 'email' }, { value: 'phoneNumber' }];

function Held({ onChange }: { onChange: (value: string) => void }): ReactElement {
  const [value, setValue] = useState('');
  return (
    <Autocomplete
      aria-label="Field"
      items={ITEMS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('Autocomplete', () => {
  it('lists every suggestion on click, before anything is typed', async () => {
    const user = userEvent.setup();
    render(<Held onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Field' }));

    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'emailemail',
      'phoneNumber',
    ]);
  });

  it('narrows the suggestions to the typed text and fills the input with the one picked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);

    await user.type(screen.getByRole('combobox', { name: 'Field' }), 'pho');

    expect(screen.queryByRole('option', { name: /email/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'phoneNumber' }));
    expect(onChange).toHaveBeenLastCalledWith('phoneNumber');
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue('phoneNumber');
  });

  it('keeps text that matches no suggestion', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);

    await user.type(screen.getByRole('combobox', { name: 'Field' }), 'custom');

    expect(onChange).toHaveBeenLastCalledWith('custom');
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue('custom');
  });
});
