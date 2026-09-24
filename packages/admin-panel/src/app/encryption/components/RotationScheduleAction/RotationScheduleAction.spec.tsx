import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RotationScheduleAction } from './RotationScheduleAction';
import type { EncryptionRotation } from '@/api/encryption/admin-encryption';

afterEach(() => {
  cleanup();
});

const WEEKLY: EncryptionRotation = {
  interval: '1w',
  nextRotationAt: '2099-09-24T09:00:36.572Z',
};

const OFF: EncryptionRotation = { interval: null, nextRotationAt: null };

const renderAction = (rotation: EncryptionRotation, onChange = vi.fn()) => {
  render(
    <RotationScheduleAction
      rotation={rotation}
      disabled={false}
      pending={false}
      onChange={onChange}
    />,
  );

  return { onChange, select: screen.getByLabelText('Automatic key rotation') };
};

describe('RotationScheduleAction', () => {
  it('offers off plus every interval the engine accepts, with the one in force selected', () => {
    const { select } = renderAction(WEEKLY);

    expect(
      Array.from(select.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual([
      'Off — rotate only on request',
      'Every 48 hours',
      'Every 96 hours',
      'Every week',
      'Every 2 weeks',
      'Every 30 days',
    ]);
    expect(select).toHaveValue('1w');
  });

  it('reports the interval chosen, on the first change rather than behind a confirm', async () => {
    const user = userEvent.setup();
    const { select, onChange } = renderAction(WEEKLY);

    await user.selectOptions(select, 'Every 48 hours');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('48h');
  });

  it('reports null for the off option, which is how the schedule is cleared', async () => {
    const user = userEvent.setup();
    const { select, onChange } = renderAction(WEEKLY);

    await user.selectOptions(select, 'Off — rotate only on request');

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows when the next rotation falls due, and where the countdown is measured from', () => {
    renderAction(WEEKLY);

    expect(screen.getByRole('region', { name: 'Key rotation schedule' })).toHaveTextContent(
      "Counted from the active key's creation, so adding a key starts it over.",
    );
  });

  it('says a schedule already past due will be acted on at the next check', () => {
    renderAction({ interval: '48h', nextRotationAt: '2020-01-01T00:00:00.000Z' });

    expect(screen.getByRole('region', { name: 'Key rotation schedule' })).toHaveTextContent(
      'Due now: the engine rotates the key on its next check',
    );
  });

  it('selects off, and explains that only an added key rotates it, when no schedule is set', () => {
    const { select } = renderAction(OFF);

    expect(select).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Key rotation schedule' })).toHaveTextContent(
      'The engine rotates the key only when you add one.',
    );
  });

  it('cannot be changed while another write is in flight, or while this one is', () => {
    render(
      <RotationScheduleAction rotation={WEEKLY} disabled pending={false} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Automatic key rotation')).toBeDisabled();

    cleanup();

    render(
      <RotationScheduleAction rotation={WEEKLY} disabled={false} pending onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Automatic key rotation')).toBeDisabled();
  });
});
