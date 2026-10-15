export interface Bank {
  /** Matches the engine's `bankId` pattern `^[a-z0-9_]+$`. */
  id: string;
  name: string;
}

/** The simulated bank with pre-registered profiles; the only one whose login works with a persona. */
export const TEST_BANK: Bank = { id: 'algoan_demo_bank', name: 'Algoan Demo Bank' };

/** The showcase's suggestions grid. */
export const SUGGESTED_BANKS: readonly Bank[] = [
  { id: 'barclays', name: 'Barclays' },
  { id: 'hsbc_uk', name: 'HSBC UK' },
  { id: 'lloyds', name: 'Lloyds' },
  { id: 'natwest', name: 'NatWest' },
  { id: 'santander_uk', name: 'Santander UK' },
  { id: 'nationwide', name: 'Nationwide' },
  { id: 'monzo', name: 'Monzo' },
  { id: 'starling', name: 'Starling' },
  { id: 'halifax', name: 'Halifax' },
  { id: 'tsb', name: 'TSB' },
  { id: 'revolut', name: 'Revolut' },
  { id: 'metro_bank', name: 'Metro Bank' },
];

/** The full list below the suggestions, alphabetical; the test bank has its own row. */
export const ALL_BANKS: readonly Bank[] = [
  ...SUGGESTED_BANKS,
  { id: 'bank_of_scotland', name: 'Bank of Scotland' },
  { id: 'clydesdale_bank', name: 'Clydesdale Bank' },
  { id: 'co_operative_bank', name: 'The Co-operative Bank' },
  { id: 'first_direct', name: 'First Direct' },
  { id: 'danske_bank_uk', name: 'Danske Bank UK' },
  { id: 'virgin_money', name: 'Virgin Money' },
  { id: 'ulster_bank', name: 'Ulster Bank' },
  { id: 'yorkshire_building_society', name: 'Yorkshire Building Society' },
].sort((a, b) => a.name.localeCompare(b.name));

/** Banks whose name contains `query`, case-insensitively; everything for a blank query. */
export function filterBanks(banks: readonly Bank[], query: string): Bank[] {
  const needle = query.trim().toLowerCase();

  return needle === ''
    ? [...banks]
    : banks.filter((bank) => bank.name.toLowerCase().includes(needle));
}

/** Up to two initials for the circle that stands in for a logo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== '' && word.toLowerCase() !== 'the')
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}
