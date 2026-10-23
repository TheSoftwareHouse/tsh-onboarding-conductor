import type { JsonValue } from '@/api/bnpl/bnpl.client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { SAR_TO_GBP_RATE } from './money';

export { SAR_TO_GBP_RATE };

export interface LeanIncome {
  outcome: string | null;
  salaryMonthlyAverage: number | null;
  salaryMonthsDetected: number | null;
  nonSalaryMonthlyAverage: number | null;
  employerName: string | null;
  salaryConsistent: boolean | null;
  salaryThresholdMet: boolean | null;
}

const number = (value: JsonValue | undefined): number | null =>
  typeof value === 'number' ? value : null;
const boolean = (value: JsonValue | undefined): boolean | null =>
  typeof value === 'boolean' ? value : null;
const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The `lean_bank_data` callback fields the KSA workflow marks client-visible. */
export function selectLeanIncome(data: Record<string, JsonValue>): LeanIncome {
  return {
    outcome: text(data.bankConnectOutcome),
    salaryMonthlyAverage: number(data.salaryMonthlyAverage),
    salaryMonthsDetected: number(data.salaryMonthsDetected),
    nonSalaryMonthlyAverage: number(data.nonSalaryMonthlyAverage),
    employerName: text(data.employerName),
    salaryConsistent: boolean(data.salaryConsistent),
    salaryThresholdMet: boolean(data.salaryThresholdMet),
  };
}

export function formatSar(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: 0,
  }).format(value);
}

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">n/a</span>;
  }
  return <Badge variant={value ? 'success' : 'warning'}>{value ? 'Yes' : 'No'}</Badge>;
}

/** Lean's own verdict on the linked bank: shown beside Algoan's, never routed on (ADR 0052). */
export function LeanIncomePanel({ data }: { data: Record<string, JsonValue> }) {
  const income = selectLeanIncome(data);

  return (
    <Card data-testid="lean-income-panel">
      <CardHeader>
        <CardTitle>Income at the bank (Lean)</CardTitle>
        <CardDescription>
          Figures in SAR, from Lean&apos;s income and employment insights over six months. Algoan
          scored the same accounts converted to GBP at a fixed rate of {SAR_TO_GBP_RATE} per riyal;
          its figures below are shown back in SAR at the same rate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {income.outcome !== 'connected' ? (
          <p className="text-sm text-muted-foreground">
            No bank data: the link ended as {income.outcome ?? 'unknown'}.
          </p>
        ) : (
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Salary, monthly average</dt>
              <dd className="text-lg font-medium text-card-foreground">
                {income.salaryMonthlyAverage === null
                  ? 'n/a'
                  : formatSar(income.salaryMonthlyAverage)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Months with a salary</dt>
              <dd className="text-lg font-medium text-card-foreground">
                {income.salaryMonthsDetected ?? 'n/a'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">
                Other income, monthly average
              </dt>
              <dd className="text-lg font-medium text-card-foreground">
                {income.nonSalaryMonthlyAverage === null
                  ? 'n/a'
                  : formatSar(income.nonSalaryMonthlyAverage)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Employer</dt>
              <dd className="text-lg font-medium text-card-foreground">
                {income.employerName ?? 'Not detected'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">Salary consistent</dt>
              <dd>
                <YesNo value={income.salaryConsistent} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">
                Above the 4 000 SAR threshold
              </dt>
              <dd>
                <YesNo value={income.salaryThresholdMet} />
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
