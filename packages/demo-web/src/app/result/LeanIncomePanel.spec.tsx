import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatSar, LeanIncomePanel, selectLeanIncome } from './LeanIncomePanel';

describe('LeanIncomePanel', () => {
  it('shows the Lean income fields in SAR and the conversion note', () => {
    render(
      <LeanIncomePanel
        data={{
          bankConnectOutcome: 'connected',
          salaryMonthlyAverage: 48435,
          salaryMonthsDetected: 7,
          nonSalaryMonthlyAverage: 1200,
          employerName: 'lean company',
          salaryConsistent: true,
          salaryThresholdMet: true,
        }}
      />,
    );

    expect(screen.getByText('Income at the bank (Lean)')).toBeInTheDocument();
    // Intl pads the currency with a non-breaking space; match the digits.
    expect(formatSar(48435)).toMatch(/48,435/);
    expect(screen.getByText(/48,435/)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('lean company')).toBeInTheDocument();
    expect(screen.getAllByText('Yes')).toHaveLength(2);
    expect(screen.getByText(/fixed rate of 0\.197 per riyal/)).toBeInTheDocument();
  });

  it('says so when the bank link produced no data', () => {
    render(<LeanIncomePanel data={{ bankConnectOutcome: 'data_unavailable' }} />);

    expect(
      screen.getByText(/No bank data: the link ended as data_unavailable/),
    ).toBeInTheDocument();
  });

  it('reads only well-typed fields', () => {
    expect(
      selectLeanIncome({ salaryMonthlyAverage: '1', employerName: '', salaryConsistent: 1 }),
    ).toEqual({
      outcome: null,
      salaryMonthlyAverage: null,
      salaryMonthsDetected: null,
      nonSalaryMonthlyAverage: null,
      employerName: null,
      salaryConsistent: null,
      salaryThresholdMet: null,
    });
  });
});
