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
  it('offers only the page sizes the engine accepts', () => {
    render(<PageSizeFilterField value={20} disabled={false} onChange={vi.fn()} />);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      PAGE_SIZES.map(String),
    );
    expect(screen.getByLabelText('Per page')).toHaveValue('20');
  });

  it('reports the chosen size as a number, which is what the query carries', async () => {
    const onChange = vi.fn();
    render(<PageSizeFilterField value={20} disabled={false} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Per page'), '50');

    expect(onChange).toHaveBeenLastCalledWith(50);
  });
});
