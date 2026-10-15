import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';

import { BffError, submitSession, type SessionAccount } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';
import {
  accountSelectionSchema,
  selectionMessage,
  toggle,
  type AccountSelectionValues,
} from './account-selection';
import { BankBadge } from './BankPage';

function formatBalance(account: SessionAccount): string {
  if (account.balance === null) {
    return 'n/a';
  }
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: account.currency ?? 'GBP',
    }).format(account.balance);
  } catch {
    return String(account.balance);
  }
}

export function AccountsPage() {
  const state = useSessionView('accounts');
  const navigate = useNavigate();
  const form = useForm<AccountSelectionValues>({
    resolver: zodResolver(accountSelectionSchema),
    defaultValues: { selectedAccounts: [] },
  });

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token, view } = state;
  const accounts = view.accounts ?? [];
  const bankName = accounts[0]?.bankName ?? view.data.bankName;
  const selected = form.watch('selectedAccounts');
  const { errors, isSubmitting } = form.formState;

  function select(ids: string[]) {
    form.setValue('selectedAccounts', ids, { shouldValidate: form.formState.isSubmitted });
  }

  async function onSubmit(values: AccountSelectionValues) {
    try {
      await submitSession(token, { selectedAccounts: values.selectedAccounts });
      void navigate(sessionPath(token, 'bank/consent'));
    } catch (error) {
      const codes = error instanceof BffError ? error.errors?.selectedAccounts : undefined;

      form.setError(codes === undefined ? 'root' : 'selectedAccounts', {
        message:
          codes === undefined
            ? error instanceof Error
              ? error.message
              : 'Could not save your selection.'
            : selectionMessage(codes),
      });
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <BankBadge name={typeof bankName === 'string' ? bankName : 'Bank'} />
          <div>
            <CardTitle>Select accounts for analysis</CardTitle>
            <CardDescription>{typeof bankName === 'string' ? bankName : null}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        >
          {view.retry === true ? (
            <p role="status" className="rounded-md border border-warning bg-warning/15 p-3 text-sm">
              The credit check could not finish
              {view.attempt === undefined ? '' : ` (attempt ${view.attempt})`}. Confirm your
              accounts to try again.
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Checkbox
              id="select-all"
              checked={accounts.length > 0 && selected.length === accounts.length}
              onCheckedChange={(checked) =>
                select(checked === true ? accounts.map((account) => account.id) : [])
              }
            />
            <Label htmlFor="select-all">Select all accounts</Label>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3 p-3">
                <Checkbox
                  id={account.id}
                  checked={selected.includes(account.id)}
                  onCheckedChange={(checked) =>
                    select(toggle(selected, account.id, checked === true))
                  }
                />
                <Label htmlFor={account.id} className="flex flex-1 flex-col items-start gap-0.5">
                  <span>{account.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {account.accountNumber === null ? '' : `**** ${account.accountNumber}`}
                  </span>
                </Label>
                <span className="tabular-nums">{formatBalance(account)}</span>
              </li>
            ))}
          </ul>
          {errors.selectedAccounts === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {errors.selectedAccounts.message}
            </p>
          )}
          {errors.root === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Confirm'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
