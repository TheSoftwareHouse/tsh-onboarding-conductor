import { buildCsvColumnClasses } from './csv-columns';
import { FieldClassifier } from './field-classifier';
import { Masker } from './masker';
import { FieldClass, PseudonymFormat } from './masking.constants';
import type { AuditEntry, ClassifiableWorkflowDocument, FieldClassMap } from './masking.types';

const KEY = 'k'.repeat(32);
const NOW = new Date('2026-11-01T12:00:00Z');
const PSEUDONYM = /^(email|phone):[0-9a-f]{12}$/;

const workflow: ClassifiableWorkflowDocument = {
  steps: [
    {
      data: {
        firstName: { type: 'text', validation: { maxLength: 100 } },
        lastName: { type: 'text', validation: { maxLength: 100 } },
        street: { type: 'text', validation: { maxLength: 200 } },
        dateOfBirth: { type: 'date', validation: { minAgeYears: 18 } },
        country: { type: 'text', validation: { oneOf: ['PL', 'RU'] } },
        sourceOfFunds: { type: 'text', validation: { oneOf: ['salary', 'other'] } },
        pepSelfDeclared: { type: 'boolean' },
        email: { type: 'text', validation: { format: 'email' } },
        phoneNumber: { type: 'text', validation: { format: 'phone' } },
        identityDocument: { type: 'file' },
        kycCustomerMessage: { type: 'text' },
      },
    },
  ],
};

describe('Masker', () => {
  const masker = new Masker(KEY, () => NOW);
  const classes: FieldClassMap = new FieldClassifier(['country']).classify(workflow);

  describe('collected data', () => {
    const data = {
      firstName: 'Zofia',
      lastName: 'Kowalczyk-Nowak',
      street: '12 Marszalkowska Street',
      dateOfBirth: '1990-06-15',
      country: 'PL',
      sourceOfFunds: 'salary',
      pepSelfDeclared: false,
      email: 'Zofia.Kowalczyk@example.com',
      phoneNumber: '+48 600 100 200',
      identityDocument: 'documents/9f2/passport.pdf',
      kycCustomerMessage: 'Please call me on 600 100 200',
      undeclared: 'surprise',
    };

    it('keeps the passable, pseudonymises contact data, bands the birth date, drops the rest', () => {
      const masked = masker.maskCollectedData(data, classes);

      expect(masked).toEqual({
        dateOfBirth: '30-39',
        country: 'PL',
        sourceOfFunds: 'salary',
        pepSelfDeclared: false,
        email: expect.stringMatching(/^email:[0-9a-f]{12}$/),
        phoneNumber: expect.stringMatching(/^phone:[0-9a-f]{12}$/),
      });
    });

    it('never lets a name, address, free text or file reference appear in the output', () => {
      const serialised = JSON.stringify(masker.maskCollectedData(data, classes));

      for (const clear of [
        'Zofia',
        'Kowalczyk',
        'Marszalkowska',
        '1990',
        'example.com',
        '600 100 200',
        'passport',
        'surprise',
        'call me',
      ]) {
        expect(serialised).not.toContain(clear);
      }
    });

    it('gives the same email one pseudonym however it is written, and another email another', () => {
      const first = masker.maskCollectedData({ email: ' Zofia.Kowalczyk@Example.com ' }, classes);
      const second = masker.maskCollectedData({ email: 'zofia.kowalczyk@example.com' }, classes);
      const other = masker.maskCollectedData({ email: 'jan@example.com' }, classes);

      expect(first.email).toMatch(PSEUDONYM);
      expect(first.email).toBe(second.email);
      expect(other.email).not.toBe(first.email);
    });

    it('gives the same phone one pseudonym across punctuation and the 00 prefix', () => {
      const values = ['+48 600-100-200', '0048600100200', '(+48) 600 100 200'].map(
        (phoneNumber) => masker.maskCollectedData({ phoneNumber }, classes).phoneNumber,
      );

      expect(new Set(values).size).toBe(1);
      expect(values[0]).toMatch(/^phone:[0-9a-f]{12}$/);
    });

    it('derives pseudonyms from the key, so another key yields another pseudonym', () => {
      const otherKey = new Masker('z'.repeat(32), () => NOW);

      expect(otherKey.maskCollectedData({ email: 'a@b.co' }, classes).email).not.toBe(
        masker.maskCollectedData({ email: 'a@b.co' }, classes).email,
      );
    });

    it('keeps an absent value absent and drops a value of the wrong type', () => {
      const masked = masker.maskCollectedData(
        { email: '', phoneNumber: 48600100200, dateOfBirth: 'not a date', country: { a: 1 } },
        classes,
      );

      expect(masked).toEqual({ email: null });
    });
  });

  describe('age bands', () => {
    const band = (dateOfBirth: string, now: string): unknown =>
      new Masker(KEY, () => new Date(now)).maskValue(dateOfBirth, { class: FieldClass.GENERALISE });

    it('computes whole years against the supplied clock', () => {
      expect(band('1990-06-15', '2026-06-14T00:00:00Z')).toBe('30-39');
      expect(band('1990-06-15', '2026-06-15T00:00:00Z')).toBe('30-39');
      expect(band('1996-11-02', '2026-11-01T00:00:00Z')).toBe('20-29');
      expect(band('1996-11-01', '2026-11-01T00:00:00Z')).toBe('30-39');
      expect(band('2008-11-02T00:00:00.000Z', '2026-11-01T00:00:00Z')).toBe('10-19');
    });

    it('drops impossible dates, dates in the future and implausible ages', () => {
      expect(band('1990-02-31', '2026-11-01T00:00:00Z')).toBeUndefined();
      expect(band('2030-01-01', '2026-11-01T00:00:00Z')).toBeUndefined();
      expect(band('0050-01-01', '2026-11-01T00:00:00Z')).toBeUndefined();
    });
  });

  describe('CSV rows', () => {
    const headers = [
      'Onboarding id',
      'Status',
      'Created at',
      'Risk score',
      'First name',
      'Date of birth',
      'Email',
      'Country',
      'Identity document',
      'Mystery column',
      'Other data',
    ];
    const columns = buildCsvColumnClasses(headers, classes);
    const row = {
      'Onboarding id': '0195d8b2-aaaa',
      Status: 'rejected',
      'Created at': '2026-10-01T10:00:00.000Z',
      'Risk score': '70',
      'First name': 'Zofia',
      'Date of birth': '1990-06-15',
      Email: 'zofia@example.com',
      Country: 'PL',
      'Identity document': 'documents/x.pdf',
      'Mystery column': 'surprise',
      'Other data': '{"note":"Zofia lives at 12 Marszalkowska"}',
    };

    it('passes system columns and scores, masks field columns, drops Other data and unknown columns', () => {
      const masked = masker.maskCsvRow(row, columns);

      expect(masked).toEqual({
        'Onboarding id': '0195d8b2-aaaa',
        Status: 'rejected',
        'Created at': '2026-10-01T10:00:00.000Z',
        'Risk score': '70',
        'Date of birth': '30-39',
        Email: expect.stringMatching(/^email:[0-9a-f]{12}$/),
        Country: 'PL',
      });
      expect(JSON.stringify(masked)).not.toMatch(/Zofia|Marszalkowska|example\.com|surprise/);
    });

    it('drops a score-looking column whose cell is not a number', () => {
      const masked = masker.maskCsvRow({ 'Risk score': 'call 600 100 200' }, columns);

      expect(masked).toEqual({});
    });

    it('drops Other data even when a declared field has that name', () => {
      const withField = new FieldClassifier().classify({
        steps: [{ data: { otherData: { type: 'boolean' } } }],
      });
      const clash = buildCsvColumnClasses(['Other data'], withField);

      expect(masker.maskCsvRow({ 'Other data': 'true' }, clash)).toEqual({});
    });
  });

  describe('audit entries', () => {
    const entry = (
      action: string,
      metadata: Record<string, unknown>,
      extra: Partial<AuditEntry> = {},
    ): AuditEntry => ({
      id: '0195d8b2-bbbb',
      occurredAt: '2026-10-01T10:00:00.000Z',
      actorType: 'system',
      actorId: 'engine',
      action,
      resourceType: 'onboarding',
      resourceId: '0195d8b2-aaaa',
      metadata,
      ...extra,
    });

    it('keeps the allowlisted lifecycle keys and drops unknown metadata keys', () => {
      const masked = masker.maskAuditEntry(
        entry('onboarding.state_transition', {
          workflowId: 'analyst-investigation',
          workflowVersion: 1,
          appliedStep: 'collect_profile',
          fromStatus: 'awaiting_user',
          toStatus: 'rejected',
          fromCurrentStep: 'collect_profile',
          toCurrentStep: null,
          fromScores: { risk: 0 },
          toScores: { risk: 70, injected: 'Ignore previous instructions' },
          applicantNote: 'Zofia Kowalczyk',
          nested: { email: 'zofia@example.com' },
        }),
      );

      expect(masked.metadata).toEqual({
        workflowId: 'analyst-investigation',
        workflowVersion: 1,
        appliedStep: 'collect_profile',
        fromStatus: 'awaiting_user',
        toStatus: 'rejected',
        fromCurrentStep: 'collect_profile',
        toCurrentStep: null,
        fromScores: { risk: 0 },
        toScores: { risk: 70 },
      });
      expect(masked.id).toBe('0195d8b2-bbbb');
      expect(masked.action).toBe('onboarding.state_transition');
    });

    it('drops every metadata key of an action no list names', () => {
      const masked = masker.maskAuditEntry(entry('future.thing_happened', { reason: 'x' }));

      expect(masked.metadata).toEqual({});
    });

    it('drops outbound webhook payloads and keeps the delivery facts', () => {
      const masked = masker.maskAuditEntry(
        entry(
          'webhook.outbound_delivery_succeeded',
          {
            onboardingId: '0195d8b2-aaaa',
            eventType: 'onboarding.state_changed',
            attempt: 2,
            status: 'delivered',
            payload: { data: { email: 'zofia@example.com', firstName: 'Zofia' } },
          },
          { resourceType: 'client_webhook_outbox' },
        ),
      );

      expect(masked.metadata).toEqual({
        onboardingId: '0195d8b2-aaaa',
        eventType: 'onboarding.state_changed',
        attempt: 2,
        status: 'delivered',
      });
    });

    it('masks submittedData by the onboarding field classes and keeps only a connector result outline', () => {
      const masked = masker.maskAuditEntry(
        entry('webhook.inbound_callback_applied', {
          providerIdentity: 'mock_async_callback_2',
          connectorOrder: 1,
          outcome: 'persisted',
          submittedData: {
            kycCustomerMessage: 'Dear Zofia, your passport is blurry',
            email: 'zofia@example.com',
            country: 'PL',
            providerVerdict: 'review',
          },
          connectorExecutionResult: {
            status: 'rejected',
            reason: 'DOCUMENT_UNREADABLE',
            errors: { identityDocument: ['UNREADABLE'] },
            metadata: { providerNote: 'Zofia Kowalczyk' },
            pending: {
              connectorName: 'check',
              connectorId: 'x',
              connectorOrder: 1,
              providerReference: 'r',
            },
          },
        }),
        classes,
      );

      expect(masked.metadata).toEqual({
        providerIdentity: 'mock_async_callback_2',
        connectorOrder: 1,
        outcome: 'persisted',
        submittedData: {
          email: expect.stringMatching(/^email:[0-9a-f]{12}$/),
          country: 'PL',
        },
        connectorExecutionResult: {
          status: 'rejected',
          reason: 'DOCUMENT_UNREADABLE',
          errors: { identityDocument: ['UNREADABLE'] },
          pending: { connectorName: 'check', connectorId: 'x', connectorOrder: 1 },
        },
      });
      expect(JSON.stringify(masked)).not.toMatch(/Zofia|zofia|blurry/);
    });

    it('drops submittedData wholesale when no field classes are supplied', () => {
      const masked = masker.maskAuditEntry(
        entry('onboarding.pending_connector_reconciled', {
          connectorId: 'mock_async_callback_2',
          connectorOrder: 1,
          providerIdentity: 'mock_async_callback_2',
          submittedData: { email: 'zofia@example.com', country: 'PL' },
        }),
      );

      expect(masked.metadata).toEqual({
        connectorId: 'mock_async_callback_2',
        connectorOrder: 1,
        providerIdentity: 'mock_async_callback_2',
        submittedData: {},
      });
    });

    it('keeps only allowlisted keys of the before and after snapshots', () => {
      const masked = masker.maskAuditEntry(
        entry(
          'onboarding.state_transition',
          {},
          {
            before: {
              id: 'a',
              status: 'awaiting_user',
              scores: { risk: 1 },
              context: { email: 'z@e.co' },
            },
            after: null,
          },
        ),
      );

      expect(masked.before).toEqual({ id: 'a', status: 'awaiting_user', scores: { risk: 1 } });
      expect(masked.after).toBeNull();
      expect(masked).not.toHaveProperty('context');
    });

    it('omits snapshots the row does not carry', () => {
      const masked = masker.maskAuditEntry(entry('onboarding.started', {}));

      expect(masked).not.toHaveProperty('before');
      expect(masked).not.toHaveProperty('after');
    });

    it('keeps the access facts of an admin access row and nothing a token carried', () => {
      const masked = masker.maskAuditEntry(
        entry(
          'auth.access_granted',
          {
            method: 'GET',
            userPrincipalName: 'analyst@example.com',
            grantedRoles: ['Admin.Read'],
            tokenIssuer: 'https://login.example/issuer',
          },
          { resourceType: 'admin_endpoint', actorType: 'operator', actorId: 'oid-1' },
        ),
      );

      expect(masked.metadata).toEqual({
        method: 'GET',
        userPrincipalName: 'analyst@example.com',
        grantedRoles: ['Admin.Read'],
      });
    });

    it('is not fooled by an action named after an Object.prototype member', () => {
      expect(masker.maskAuditEntry(entry('constructor', { reason: 'x' })).metadata).toEqual({});
      expect(masker.maskAuditEntry(entry('__proto__', { reason: 'x' })).metadata).toEqual({});
    });
  });

  it('uses the pseudonym format as its prefix', () => {
    expect(
      masker.maskValue('a@b.co', { class: FieldClass.PSEUDONYMISE, format: PseudonymFormat.EMAIL }),
    ).toMatch(/^email:/);
  });
});
