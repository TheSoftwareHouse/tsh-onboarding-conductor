#!/usr/bin/env node
'use strict';

// Shifts a bank-data document (Algoan "ALGOAN" format: accounts[] with balanceDate and
// transactions[].dates.*) so its latest balanceDate lands on today at 12:00 UTC. Algoan ignores
// transactions older than 90 days before the balance date, so the personae's upstream dates must
// be moved before every push. Usage: node scripts/rebase-bank-data-dates.cjs <in.json> [out.json]
// (stdout when out.json is omitted).

const fs = require('node:fs');

const DAY_MS = 86_400_000;

function todayNoonUtc(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
}

function shift(value, deltaMs) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time + deltaMs).toISOString();
}

/** Returns a copy of `bankData` with every date shifted by `today - max(balanceDate)`. */
function rebaseBankData(bankData, now = new Date()) {
  const accounts = bankData.accounts ?? [];
  const latest = Math.max(
    ...accounts.map((a) => Date.parse(a.balanceDate)).filter((t) => !Number.isNaN(t)),
  );
  if (!Number.isFinite(latest)) {
    throw new Error('no account carries a parsable balanceDate');
  }
  // Whole days only, so the time of day in the source file is preserved.
  const deltaMs = Math.round((todayNoonUtc(now) - latest) / DAY_MS) * DAY_MS;

  return {
    ...bankData,
    accounts: accounts.map((account) => ({
      ...account,
      balanceDate: shift(account.balanceDate, deltaMs),
      transactions: (account.transactions ?? []).map((tx) => ({
        ...tx,
        dates: Object.fromEntries(
          Object.entries(tx.dates ?? {}).map(([key, value]) => [key, shift(value, deltaMs)]),
        ),
      })),
    })),
  };
}

function main(argv) {
  const [input, output] = argv;
  if (!input || input === '--help' || input === '-h') {
    process.stderr.write('Usage: node scripts/rebase-bank-data-dates.cjs <in.json> [out.json]\n');
    return input ? 0 : 1;
  }
  const rebased = rebaseBankData(JSON.parse(fs.readFileSync(input, 'utf8')));
  const text = JSON.stringify(rebased);
  if (output) {
    fs.writeFileSync(output, text);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`rebase-bank-data-dates: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { rebaseBankData };
