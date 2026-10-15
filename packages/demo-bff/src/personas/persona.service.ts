import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { BankData } from './rebase-dates';

export type PersonaBand = 'approved' | 'review' | 'declined';
export type PersonaProfile = 'high' | 'medium' | 'low' | 'test';

export interface PersonaSummary {
  id: string;
  name: string;
  story: string;
  expectedBand: PersonaBand;
  expectedScore: number;
  profile: PersonaProfile;
  profileLabel: string;
  /** Left out of the start page's cards; reachable through `/start/<id>` (test-only personae). */
  hidden?: true;
}

export type AccountType = 'CHECKING' | 'SAVINGS';

export interface PersonaAccountSummary {
  /** Opaque position in the persona file (`account-01`, `account-02`); the only id the engine sees. */
  id: string;
  type: AccountType | null;
  name: string;
  bankName: string | null;
  owner: string | null;
  /** The last four characters of the IBAN, the rest masked. */
  accountNumber: string | null;
  balance: number | null;
  currency: string | null;
}

export class PersonaNotFoundError extends Error {
  constructor(readonly personaId: string) {
    super(`Unknown persona "${personaId}"`);
    this.name = 'PersonaNotFoundError';
  }
}

// Hard-coded from the table in packages/demo-bff/personas/README.md (sandbox scores measured
// 2026-10-15, re-measured with both accounts the same day). Keep the two in step when a persona is added or re-measured.
const PERSONAS: readonly PersonaSummary[] = [
  {
    id: 'sherlock_holmes',
    name: 'Sherlock Holmes',
    story:
      '£2 500/month wage, mortgage, four consumer credits, two split payments, no incidents, stable cash flows.',
    expectedBand: 'approved',
    expectedScore: 965,
    profile: 'high',
    profileLabel: 'High score · High disposable income · No incidents',
  },
  {
    id: 'james_watson',
    name: 'James Watson',
    story:
      '£1 350/month wage, frequent gambling, overdraft fees, unpaid direct debits, two consumer loans.',
    expectedBand: 'review',
    expectedScore: 598,
    profile: 'medium',
    profileLabel: 'Medium score · Modest income · Overdraft and gambling',
  },
  {
    id: 'james_moriarty',
    name: 'James Moriarty',
    story:
      'No wage, Universal Credit only (£620/month), heavier gambling, debt-collection and bailiff payments, deeper overdraft.',
    expectedBand: 'declined',
    expectedScore: 362,
    profile: 'low',
    profileLabel: 'Low score · Benefits only · Debt collection and bailiffs',
  },
  {
    id: 'fail_case',
    name: 'Fail Case',
    story: 'Test-only: the provider fails the analysis',
    expectedBand: 'declined',
    expectedScore: 0,
    profile: 'test',
    profileLabel: 'Test profile · Provider fails the analysis',
    hidden: true,
  },
];

const LOCALE = 'en';
const ACCOUNT_NAMES: Record<AccountType, string> = {
  CHECKING: 'Current account',
  SAVINGS: 'Savings account',
};
const ACCOUNT_ID_DIGITS = 2;

/** The opaque id of the account at `index` in a persona file. */
export function accountIdAt(index: number): string {
  return `account-${String(index + 1).padStart(ACCOUNT_ID_DIGITS, '0')}`;
}

/** The demo personae: their README metadata and their stored Open Banking documents. */
@Injectable()
export class PersonaService {
  private readonly dir: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.dir = config.get('PERSONAS_DIR', { infer: true });
  }

  list(): PersonaSummary[] {
    return PERSONAS.map((persona) => ({ ...persona }));
  }

  summary(id: string): PersonaSummary {
    const persona = PERSONAS.find((candidate) => candidate.id === id);

    if (persona === undefined) {
      throw new PersonaNotFoundError(id);
    }

    return { ...persona };
  }

  /** The stored document, with its upstream dates: rebase before pushing. */
  load(id: string): BankData {
    if (!PERSONAS.some((persona) => persona.id === id)) {
      throw new PersonaNotFoundError(id);
    }

    return JSON.parse(readFileSync(join(this.dir, LOCALE, `${id}.json`), 'utf8')) as BankData;
  }

  accounts(id: string): PersonaAccountSummary[] {
    return this.load(id).accounts.map((account, index) => {
      const type = account.type === 'CHECKING' || account.type === 'SAVINGS' ? account.type : null;

      return {
        id: accountIdAt(index),
        type,
        name: type === null ? 'Account' : ACCOUNT_NAMES[type],
        bankName: account.bank?.name ?? null,
        owner: account.owners?.[0]?.name ?? null,
        accountNumber: account.iban ? lastFour(account.iban) : null,
        balance: account.balance ?? null,
        currency: account.currency ?? null,
      };
    });
  }
}

/** The last four characters of an account identifier; the web app adds the masking prefix. */
function lastFour(value: string): string {
  return value.replace(/\s+/g, '').slice(-4);
}
