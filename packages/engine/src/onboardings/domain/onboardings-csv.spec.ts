import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import {
  buildOnboardingsCsvColumns,
  CSV_BOM,
  toOnboardingsCsvHeader,
  toOnboardingsCsvRow,
  type OnboardingsCsvColumns,
  type OnboardingsCsvRecord,
} from './onboardings-csv';

const definition = (
  id: string,
  version: number,
  steps: Array<Record<string, { persist: boolean }>>,
  scores: string[] = [],
): NormalizedWorkflowDefinition =>
  ({
    id,
    version,
    steps: steps.map((data, index) => ({
      name: `step${index}`,
      data: Object.fromEntries(
        Object.entries(data).map(([key, field]) => [
          key,
          { type: 'text', required: true, ...field },
        ]),
      ),
    })),
    scores: Object.fromEntries(scores.map((name) => [name, {}])),
  }) as unknown as NormalizedWorkflowDefinition;

const NO_COLUMNS: OnboardingsCsvColumns = { scoreNames: [], dataFields: [] };

const record = (overrides: Partial<OnboardingsCsvRecord> = {}): OnboardingsCsvRecord => ({
  onboardingId: 'id-1',
  workflowId: 'wf',
  workflowVersion: 2,
  status: 'in_progress',
  currentStep: 'start',
  agreementStatus: null,
  rejectionReason: null,
  createdAt: new Date('2026-01-02T03:04:05.678Z'),
  updatedAt: new Date('2026-01-02T03:04:06.000Z'),
  completedAt: null,
  scores: {},
  context: {},
  ...overrides,
});

const rowFor = (context: Record<string, unknown>, dataFields: string[]): string =>
  toOnboardingsCsvRow(record({ context }), { scoreNames: [], dataFields });

describe('onboardings CSV', () => {
  describe('buildOnboardingsCsvColumns', () => {
    it('sorts score names and unions them across definitions', () => {
      const columns = buildOnboardingsCsvColumns([
        definition('a', 1, [], ['risk', 'age']),
        definition('b', 1, [], ['age', 'credit']),
      ]);

      expect(columns.scoreNames).toEqual(['age', 'credit', 'risk']);
    });

    it('orders fields by definition id then version, then step order, first appearance winning', () => {
      const columns = buildOnboardingsCsvColumns([
        definition('b', 1, [{ email: { persist: true }, zip: { persist: true } }]),
        definition('a', 2, [{ name: { persist: true } }, { email: { persist: true } }]),
        definition('a', 1, [{ phone: { persist: true }, name: { persist: true } }]),
      ]);

      expect(columns.dataFields).toEqual(['phone', 'name', 'email', 'zip']);
    });

    it('excludes fields declared with persist false', () => {
      const columns = buildOnboardingsCsvColumns([
        definition('a', 1, [{ name: { persist: true }, password: { persist: false } }]),
      ]);

      expect(columns.dataFields).toEqual(['name']);
    });
  });

  describe('header', () => {
    it('lists fixed, score, data and other columns with a CRLF terminator', () => {
      const header = toOnboardingsCsvHeader({ scoreNames: ['risk'], dataFields: ['name'] });

      expect(header).toBe(
        'Onboarding id,Workflow id,Workflow version,Status,Current step,Agreement status,Rejection reason,Created at,Updated at,Completed at,Risk score,Name,Other data\r\n',
      );
    });

    it.each([
      ['camelCase', 'firstName', 'First name'],
      ['snake_case', 'first_name', 'First name'],
      ['kebab-case', 'first-name', 'First name'],
      ['an acronym run', 'HTMLField', 'HTML field'],
      ['a trailing acronym', 'userID', 'User ID'],
      ['digits', 'address2', 'Address2'],
      ['a key yielding no words', '_', '_'],
    ])('humanizes %s', (_name, key, label) => {
      const header = toOnboardingsCsvHeader({ scoreNames: [], dataFields: [key] });

      expect(header.split('\r\n')[0].split(',').slice(-2)).toEqual([label, 'Other data']);
    });

    it('suffixes score labels and keeps a score and a field sharing a key apart', () => {
      const header = toOnboardingsCsvHeader({
        scoreNames: ['amlRisk', 'risk'],
        dataFields: ['risk'],
      });

      expect(header.split('\r\n')[0].split(',').slice(-4)).toEqual([
        'Aml risk score',
        'Risk score',
        'Risk',
        'Other data',
      ]);
    });

    it('exposes a BOM constant', () => {
      expect(CSV_BOM).toBe('﻿');
    });
  });

  describe('row', () => {
    it('emits fixed columns as ISO dates, empty for null, with a CRLF terminator', () => {
      expect(toOnboardingsCsvRow(record(), NO_COLUMNS)).toBe(
        'id-1,wf,2,in_progress,start,,,2026-01-02T03:04:05.678Z,2026-01-02T03:04:06.000Z,,\r\n',
      );
    });

    it.each([
      ['a,b', '"a,b"'],
      ['say "hi"', '"say ""hi"""'],
      ['line1\nline2', '"line1\nline2"'],
      ['line1\rline2', '"line1\rline2"'],
    ])('quotes %j', (value, expected) => {
      expect(rowFor({ f: value }, ['f'])).toBe(
        `id-1,wf,2,in_progress,start,,,2026-01-02T03:04:05.678Z,2026-01-02T03:04:06.000Z,,${expected},\r\n`,
      );
    });

    it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])(
      'guards a formula trigger in %j',
      (value) => {
        const cells = rowFor({ f: value }, ['f']);

        expect(cells).toContain(`'${value}`);
      },
    );

    it('does not guard numbers, and does not guard strings that merely contain a trigger', () => {
      const row = rowFor({ n: -5, s: 'a=b' }, ['n', 's']);

      expect(row).toContain(',-5,a=b,');
    });

    it('serialises objects and arrays as JSON and booleans and numbers via String', () => {
      const row = rowFor({ doc: { id: 1 }, tags: ['a', 'b'], ok: true, count: 3 }, [
        'doc',
        'tags',
        'ok',
        'count',
      ]);

      expect(row).toContain(',"{""id"":1}","[""a"",""b""]",true,3,');
    });

    it('writes score values and leaves missing scores empty', () => {
      const row = toOnboardingsCsvRow(record({ scores: { risk: 7 } }), {
        scoreNames: ['age', 'risk'],
        dataFields: [],
      });

      expect(row).toContain('Z,,,7,\r\n');
    });

    it('fills the other-data column only from keys no declared column covers', () => {
      const covered = rowFor({ name: 'Ann' }, ['name']);
      const uncovered = rowFor({ name: 'Ann', kycOutcome: 'ok' }, ['name']);

      expect(covered.endsWith(',Ann,\r\n')).toBe(true);
      expect(uncovered.endsWith(',Ann,"{""kycOutcome"":""ok""}"\r\n')).toBe(true);
    });

    it('puts the whole context in the other-data column when no column is declared', () => {
      expect(rowFor({ a: 1 }, []).endsWith(',"{""a"":1}"\r\n')).toBe(true);
    });
  });
});
