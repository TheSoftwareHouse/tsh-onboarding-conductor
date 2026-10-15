import { NotComputed } from './NotComputed';
import {
  type CalendarEntry,
  type CategoryRow,
  type InsightTiles,
  formatGbp,
} from './report-selectors';

const MIN_BAR_PERCENT = 6;

function Tile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className="text-xl font-semibold tabular-nums text-card-foreground"
        style={value !== null && value < 0 ? { color: '#d92d20' } : undefined}
      >
        {value === null ? 'Not computed' : formatGbp(value)}
      </span>
    </div>
  );
}

function Calendar({ entries }: { entries: CalendarEntry[] }) {
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">No monthly data</span>;
  }
  const peak = Math.max(...entries.map((entry) => Math.abs(entry.amount)), 1);
  return (
    <ul className="flex h-8 items-end gap-1" aria-label="Amount per month">
      {entries.map((entry) => (
        <li
          key={entry.month}
          title={`${entry.month}: ${formatGbp(entry.amount)}`}
          aria-label={`${entry.month}: ${formatGbp(entry.amount)}`}
          className="w-3 rounded-t-sm bg-primary"
          style={{ height: `${Math.max((Math.abs(entry.amount) / peak) * 100, MIN_BAR_PERCENT)}%` }}
        />
      ))}
    </ul>
  );
}

function CategoryList({ title, rows }: { title: string; rows: CategoryRow[] }) {
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-medium text-card-foreground">{title}</h4>
      {rows.length === 0 ? (
        <NotComputed what={title.toLowerCase()} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <li
              key={`${row.kind}-${row.name}`}
              className="flex items-center justify-between gap-4 p-3"
            >
              <span className="text-sm capitalize text-card-foreground">{row.name}</span>
              <Calendar entries={row.calendar} />
              <span className="w-28 text-right text-sm tabular-nums">
                {row.monthlyAmount === null
                  ? 'Not computed'
                  : `${formatGbp(row.monthlyAmount)} / mo`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InsightsCategories({
  tiles,
  categories,
}: {
  tiles: InsightTiles;
  categories: CategoryRow[];
}) {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Regular monthly incomes" value={tiles.incomes} />
        <Tile label="Regular monthly expenses" value={tiles.expenses} />
        <Tile label="Loan repayments" value={tiles.repayments} />
        <Tile label="Discretionary income" value={tiles.discretionary} />
      </div>
      <CategoryList
        title="Income categories"
        rows={categories.filter((row) => row.kind === 'income')}
      />
      <CategoryList
        title="Expense categories"
        rows={categories.filter((row) => row.kind === 'expense')}
      />
    </div>
  );
}
