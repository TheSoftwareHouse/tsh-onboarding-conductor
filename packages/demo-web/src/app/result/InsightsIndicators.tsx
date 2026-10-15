import { NotComputed } from './NotComputed';
import { type LoanSummary, type RiskRow, formatGbp } from './report-selectors';

function formatRisk(row: RiskRow): string {
  if (row.value === null) {
    return 'Not computed';
  }
  switch (row.unit) {
    case 'money':
      return formatGbp(row.value);
    case 'days':
      return `${row.value} days`;
    case 'flag':
      return row.value ? 'Yes' : 'No';
    default:
      return String(row.value);
  }
}

function isAlert(row: RiskRow): boolean {
  return row.value !== null && row.value > 0;
}

export function InsightsIndicators({
  risks,
  loans,
}: {
  risks: RiskRow[] | null;
  loans: LoanSummary[] | null;
}) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <h4 className="text-sm font-medium text-card-foreground">Risks</h4>
        {risks === null ? (
          <NotComputed what="risks" />
        ) : (
          <dl className="divide-y divide-border rounded-lg border border-border bg-card">
            {risks.map((row) => (
              <div key={row.key} className="flex justify-between gap-4 p-3 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd
                  className="flex items-center gap-2 tabular-nums"
                  style={isAlert(row) ? { color: '#d92d20', fontWeight: 600 } : undefined}
                >
                  {isAlert(row) && <span aria-hidden="true">!</span>}
                  {formatRisk(row)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="grid gap-2">
        <h4 className="text-sm font-medium text-card-foreground">Loans</h4>
        {loans === null ? (
          <NotComputed what="loans" />
        ) : (
          <dl className="divide-y divide-border rounded-lg border border-border bg-card">
            {loans.map((loan) => (
              <div key={loan.kind} className="flex justify-between gap-4 p-3 text-sm">
                <dt className="capitalize text-muted-foreground">{loan.kind}</dt>
                <dd className="tabular-nums">
                  {loan.count === null ? 'Not computed' : `${loan.count} loans`}
                  {loan.totalAmount !== null && `, ${formatGbp(loan.totalAmount)} total`}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
