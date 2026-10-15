import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { NotComputed } from './NotComputed';
import { type TransactionRow, formatGbp, sortTransactionsByDate } from './report-selectors';

export function TransactionsTable({ rows }: { rows: TransactionRow[] }) {
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const sorted = useMemo(() => sortTransactionsByDate(rows, direction), [rows, direction]);

  if (rows.length === 0) {
    return <NotComputed what="transactions" />;
  }
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead aria-sort={direction === 'asc' ? 'ascending' : 'descending'}>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium"
              onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
            >
              Date <Icon className="size-3" aria-hidden="true" />
            </button>
          </TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.date ?? 'n/a'}</TableCell>
            <TableCell>{row.description}</TableCell>
            <TableCell className="capitalize">{row.category ?? 'n/a'}</TableCell>
            <TableCell
              className="text-right tabular-nums"
              style={{ color: row.amount < 0 ? '#d92d20' : '#1a8f4c' }}
            >
              {row.amount > 0 ? '+' : ''}
              {formatGbp(row.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
