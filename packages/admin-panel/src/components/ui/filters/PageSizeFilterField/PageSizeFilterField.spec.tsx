import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZES } from '@/lib/pagination';
import { PageSizeFilterField } from './PageSizeFilterField';

afterEach(() => {
  cleanup();
});

describe('PageSizeFilterField', () => {
  it('offers only the page sizes the engine accepts', async () => {
    render(<PageSizeFilterField value={20} disabled={false} onChange={vi.fn()} />);

    const trigger = screen.getByRole('combobox', { name: 'Per page' });
    expect(trigger).toHaveTextContent('20');
    await userEvent.click(trigger);

    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(
      PAGE_SIZES.map(String),
    );
  });

  it('reports the chosen size as a number, which is what the query carries', async () => {
    const onChange = vi.fn();
    render(<PageSizeFilterField value={20} disabled={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Per page' }));
    await userEvent.click(await screen.findByRole('option', { name: '50' }));

    expect(onChange).toHaveBeenLastCalledWith(50);
  });
});
