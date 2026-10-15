import type { SessionAccount } from '@/api/bnpl/bnpl.client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { NotComputed } from './NotComputed';
import { formatGbp } from './report-selectors';

function formatBalance(account: SessionAccount): string {
  if (account.balance === null) {
    return 'n/a';
  }
  const currency = account.currency ?? 'GBP';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(account.balance);
  } catch {
    return formatGbp(account.balance);
  }
}

export function AccountsTab({ accounts }: { accounts: SessionAccount[] }) {
  if (accounts.length === 0) {
    return <NotComputed what="accounts" />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bank</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Account</TableHead>
          <TableHead>Account number</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead>Currency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>{account.bankName ?? 'n/a'}</TableCell>
            <TableCell>{account.owner ?? 'n/a'}</TableCell>
            <TableCell>{account.name}</TableCell>
            <TableCell>
              {account.accountNumber === null ? 'n/a' : `**** ${account.accountNumber}`}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatBalance(account)}</TableCell>
            <TableCell>{account.currency ?? 'n/a'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
