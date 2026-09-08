import { isAuditRecorded, markAuditRecorded } from './audit-recorded.marker';

describe('markAuditRecorded / isAuditRecorded', () => {
  it('reports an unmarked error as not recorded', () => {
    expect(isAuditRecorded(new Error('boom'))).toBe(false);
  });

  it('reports a marked error as recorded', () => {
    const error = markAuditRecorded(new Error('boom'));

    expect(isAuditRecorded(error)).toBe(true);
  });

  it('returns the same error instance it was given', () => {
    const error = new Error('boom');

    expect(markAuditRecorded(error)).toBe(error);
  });

  it('never appears among the error own enumerable string keys', () => {
    const error = markAuditRecorded(new Error('boom'));

    expect(Object.keys(error)).not.toContain('auditRecorded');
    expect(Object.getOwnPropertyNames(error)).not.toContain('auditRecorded');
  });

  it('never serializes into JSON', () => {
    const error = markAuditRecorded({ code: 'SOME_CODE', message: 'SOME_CODE' });

    expect(JSON.stringify(error)).toBe(JSON.stringify({ code: 'SOME_CODE', message: 'SOME_CODE' }));
    expect(JSON.stringify(error)).not.toContain('auditRecorded');
  });

  it.each([undefined, null, 'not-an-object', 42, true])(
    'reports %p as not recorded without throwing',
    (value) => {
      expect(isAuditRecorded(value)).toBe(false);
    },
  );
});
