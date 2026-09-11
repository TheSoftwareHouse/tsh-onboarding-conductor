import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE } from '@/shared/lib/pagination';
import { buildAuditEventsSearchParams, readAuditEventFilters } from './audit-events-search-params';
import { createDefaultAuditEventFilters } from './audit-events-query';

describe('readAuditEventFilters', () => {
  it('restores every criterion the URL carries', () => {
    const filters = readAuditEventFilters(
      new URLSearchParams(
        'actorType=operator&actorId=ops-1&action=auth.access_granted&resourceType=onboarding' +
          '&resourceId=018f&occurredFrom=2026-07-01T09:00&occurredTo=2026-07-02T09:00&limit=20',
      ),
    );

    expect(filters).toEqual({
      actorType: 'operator',
      actorId: 'ops-1',
      action: 'auth.access_granted',
      resourceType: 'onboarding',
      resourceId: '018f',
      // Derived from the bounds the URL carries, not stored beside them.
      occurredPeriod: 'custom',
      occurredFrom: '2026-07-01T09:00',
      occurredTo: '2026-07-02T09:00',
      limit: 20,
    });
  });

  it('falls back to "All" for an actor type the build does not recognize', () => {
    const filters = readAuditEventFilters(new URLSearchParams('actorType=robot&action=login'));

    expect(filters.actorType).toBe('');
    expect(filters.action).toBe('login');
  });

  it.each([
    ['an unparseable datetime', 'occurredFrom=yesterday&actorId=ops-1'],
    ['a backwards window', 'occurredFrom=2026-07-02T09:00&occurredTo=2026-07-01T09:00'],
  ])('drops a set the endpoint would refuse for %s', (_case, search) => {
    expect(readAuditEventFilters(new URLSearchParams(search))).toEqual(
      createDefaultAuditEventFilters(),
    );
  });
});

describe('buildAuditEventsSearchParams', () => {
  it('round-trips the criteria an operator committed', () => {
    const filters = {
      ...createDefaultAuditEventFilters(),
      actorType: 'operator' as const,
      action: 'auth.access_granted',
      occurredPeriod: 'custom' as const,
      occurredFrom: '2026-07-01T09:00',
    };

    const params = buildAuditEventsSearchParams(filters, DEFAULT_PAGE);

    expect(params.toString()).toBe(
      'actorType=operator&action=auth.access_granted&occurredFrom=2026-07-01T09%3A00',
    );
    expect(readAuditEventFilters(params)).toEqual(filters);
  });

  it('carries a relative period instead of the instant it resolves to', () => {
    const filters = { ...createDefaultAuditEventFilters(), occurredPeriod: '24h' as const };

    const params = buildAuditEventsSearchParams(filters, DEFAULT_PAGE);

    // The link names the window, so it means the same thing whenever it is opened - which is the
    // whole point of committing the period rather than a timestamp.
    expect(params.toString()).toBe('occurredPeriod=24h');
    expect(readAuditEventFilters(params)).toEqual(filters);
  });

  it('never states a period and a pair of bounds at once', () => {
    const params = buildAuditEventsSearchParams(
      {
        ...createDefaultAuditEventFilters(),
        occurredPeriod: '1h' as const,
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      },
      DEFAULT_PAGE,
    );

    expect(params.get('occurredPeriod')).toBe('1h');
    expect(params.get('occurredFrom')).toBeNull();
    expect(params.get('occurredTo')).toBeNull();
  });

  it('ignores a period this build does not offer, rather than filtering by it', () => {
    const filters = readAuditEventFilters(new URLSearchParams('occurredPeriod=99y'));

    expect(filters.occurredPeriod).toBe('');
  });

  it('carries a non-default page window', () => {
    const params = buildAuditEventsSearchParams(
      { ...createDefaultAuditEventFilters(), limit: 20 },
      2,
    );

    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('20');
  });
});
