import type { SessionAccount } from '@/api/bnpl/bnpl.client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useMoney, type Money } from './money';
import { NotComputed } from './NotComputed';

/** The journey's currency; an account that carries another one (a UK persona's) keeps its own. */
function formatBalance(account: SessionAccount, money: Money): string {
  if (account.balance === null) {
    return 'n/a';
  }
  const currency = account.currency;
  if (currency === null || currency === 'GBP') {
    return money.format(account.balance);
  }
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(account.balance);
  } catch {
    return money.format(account.balance);
  }
}

const shownCurrency = (account: SessionAccount, money: Money): string =>
  account.currency === null || account.currency === 'GBP' ? money.currency : account.currency;

export function AccountsTab({ accounts }: { accounts: SessionAccount[] }) {
  const money = useMoney();

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
            <TableCell className="text-right tabular-nums">
              {formatBalance(account, money)}
            </TableCell>
            <TableCell>{shownCurrency(account, money)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
