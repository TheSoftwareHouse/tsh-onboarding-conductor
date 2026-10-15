import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { BankData } from './rebase-dates';

export type PersonaBand = 'approved' | 'review' | 'declined';

export interface PersonaSummary {
  id: string;
  name: string;
  story: string;
  expectedBand: PersonaBand;
  expectedScore: number;
  /** Left out of the start page's cards; reachable through `/start/<id>` (test-only personae). */
  hidden?: true;
}

export interface PersonaAccountSummary {
  bankName: string | null;
  owner: string | null;
  iban: string | null;
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
// 2026-10-15). Keep the two in step when a persona is added or re-measured.
const PERSONAS: readonly PersonaSummary[] = [
  {
    id: 'sherlock_holmes',
    name: 'Sherlock Holmes',
    story:
      '£2 500/month wage, mortgage, four consumer credits, two split payments, no incidents, stable cash flows.',
    expectedBand: 'approved',
    expectedScore: 965,
  },
  {
    id: 'james_watson',
    name: 'James Watson',
    story:
      '£1 350/month wage, frequent gambling, overdraft fees, unpaid direct debits, two consumer loans.',
    expectedBand: 'review',
    expectedScore: 598,
  },
  {
    id: 'james_moriarty',
    name: 'James Moriarty',
    story:
      'No wage, Universal Credit only (£620/month), heavier gambling, debt-collection and bailiff payments, deeper overdraft.',
    expectedBand: 'declined',
    expectedScore: 362,
  },
  {
    id: 'fail_case',
    name: 'Fail Case',
    story: 'Test-only: the provider fails the analysis',
    expectedBand: 'declined',
    expectedScore: 0,
    hidden: true,
  },
];

const LOCALE = 'en';

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

  /** The stored document, with its upstream dates: rebase before pushing. */
  load(id: string): BankData {
    if (!PERSONAS.some((persona) => persona.id === id)) {
      throw new PersonaNotFoundError(id);
    }

    return JSON.parse(readFileSync(join(this.dir, LOCALE, `${id}.json`), 'utf8')) as BankData;
  }

  accounts(id: string): PersonaAccountSummary[] {
    return this.load(id).accounts.map((account) => ({
      bankName: account.bank?.name ?? null,
      owner: account.owners?.[0]?.name ?? null,
      iban: account.iban ? maskIdentifier(account.iban) : null,
      accountNumber: account.number ? maskIdentifier(account.number) : null,
      balance: account.balance ?? null,
      currency: account.currency ?? null,
    }));
  }
}

function maskIdentifier(value: string): string {
  const compact = value.replace(/\s+/g, '');

  return compact.length <= 4 ? '****' : `${'*'.repeat(compact.length - 4)}${compact.slice(-4)}`;
}
