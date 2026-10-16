import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { submitSession } from '@/api/bnpl/bnpl.client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { sessionPath } from '../session/session-routes';
import { SessionGate, useSessionView } from '../session/useSessionView';
import { ALL_BANKS, filterBanks, initials, SUGGESTED_BANKS, TEST_BANK, type Bank } from './banks';

export function BankBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground"
    >
      {initials(name)}
    </span>
  );
}

function BankButton({
  bank,
  disabled,
  onChoose,
}: {
  bank: Bank;
  disabled: boolean;
  onChoose: (bank: Bank) => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto justify-start gap-3 py-3"
      disabled={disabled}
      onClick={() => onChoose(bank)}
    >
      <BankBadge name={bank.name} />
      <span className="text-left">{bank.name}</span>
    </Button>
  );
}

export function BankPage() {
  const state = useSessionView('bank');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== 'ready') {
    return <SessionGate state={state} />;
  }

  const { token } = state;
  const searching = query.trim() !== '';
  const matches = filterBanks(searching ? [TEST_BANK, ...ALL_BANKS] : ALL_BANKS, query);

  async function choose(bank: Bank) {
    setChoosing(bank.id);
    setError(null);
    try {
      await submitSession(token, { bankId: bank.id, bankName: bank.name });
      void navigate(sessionPath(token, 'bank/login'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not select the bank.');
      setChoosing(null);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Select your bank</CardTitle>
        <CardDescription>Choose the bank whose accounts we should analyse.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="relative">
          <Label htmlFor="bank-search" className="sr-only">
            Search for your bank
          </Label>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="bank-search"
            type="search"
            className="pl-9"
            placeholder="Search for your bank"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {searching ? (
          <div className="flex flex-col gap-2" aria-label="Search results">
            {matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bank matches “{query.trim()}”.</p>
            ) : (
              matches.map((bank) => (
                <BankButton
                  key={bank.id}
                  bank={bank}
                  disabled={choosing !== null}
                  onChoose={(b) => void choose(b)}
                />
              ))
            )}
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-card-foreground">
                Test bank with pre-registered profiles
              </h2>
              <BankButton
                bank={TEST_BANK}
                disabled={choosing !== null}
                onChoose={(b) => void choose(b)}
              />
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-card-foreground">Suggestions</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {SUGGESTED_BANKS.map((bank) => (
                  <BankButton
                    key={bank.id}
                    bank={bank}
                    disabled={choosing !== null}
                    onChoose={(b) => void choose(b)}
                  />
                ))}
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-card-foreground">All banks</h2>
              <ul className="flex flex-col divide-y divide-border">
                {matches.map((bank) => (
                  <li key={bank.id}>
                    <button
                      type="button"
                      className="w-full py-2 text-left text-sm hover:text-primary disabled:opacity-50"
                      disabled={choosing !== null}
                      onClick={() => void choose(bank)}
                    >
                      {bank.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
