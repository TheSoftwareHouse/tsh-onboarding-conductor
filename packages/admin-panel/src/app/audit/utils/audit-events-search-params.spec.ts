import { createLoader } from 'nuqs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { toAuditEventQueryFilters } from './filter-audit-events';
import {
  auditEventsSearchParams,
  serializeAuditEventsSearch,
  toAuditEventFilters,
  toAuditEventsSearchValues,
} from './audit-events-search-params';
import { DEFAULT_AUDIT_EVENT_FILTERS } from './audit-events-query';

const load = createLoader(auditEventsSearchParams);

/** Reads committed filters back from a URL the way `useAuditEvents` does: load, then derive. */
function readAuditEventFilters(search: string) {
  return toAuditEventFilters(load(search));
}

describe('toAuditEventFilters', () => {
  it('restores every criterion the URL carries', () => {
    const filters = readAuditEventFilters(
      'actorType=operator&actorId=ops-1&action=auth.access_granted&resourceType=onboarding' +
        '&resourceId=018f&occurredFrom=2026-07-01T09:00&occurredTo=2026-07-02T09:00&limit=20',
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

  it('applies the recognized criteria while falling one back to its default, rather than dropping the whole set', () => {
    const filters = readAuditEventFilters('actorType=nonsense&action=x');

    expect(filters.actorType).toBe('');
    expect(filters.action).toBe('x');
  });

  it('falls back to "All" for an actor type the build does not recognize', () => {
    const filters = readAuditEventFilters('actorType=robot&action=login');

    expect(filters.actorType).toBe('');
    expect(filters.action).toBe('login');
  });

  it('falls an unparseable datetime back to its default while keeping the other criteria', () => {
    const filters = readAuditEventFilters('occurredFrom=yesterday&actorId=ops-1');

    expect(filters.occurredFrom).toBe('');
    expect(filters.actorId).toBe('ops-1');
  });

  it('falls back to the default page size for a limit the panel does not offer', () => {
    const filters = readAuditEventFilters('limit=99999');

    expect(filters.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('ignores a period this build does not offer, rather than filtering by it', () => {
    const filters = readAuditEventFilters('occurredPeriod=99y');

    expect(filters.occurredPeriod).toBe('');
  });

  it('carries a backwards window through as stated - the range rule is checked at commit time, not here', () => {
    const filters = readAuditEventFilters(
      'occurredFrom=2026-07-02T09:00&occurredTo=2026-07-01T09:00',
    );

    expect(filters.occurredFrom).toBe('2026-07-02T09:00');
    expect(filters.occurredTo).toBe('2026-07-01T09:00');
  });

  it('reports no criteria for a bare URL', () => {
    expect(readAuditEventFilters('')).toEqual(DEFAULT_AUDIT_EVENT_FILTERS);
  });
});

describe('a URL mixing a valid criterion with a malformed one', () => {
  it('keeps the valid criterion in the query filters when an unrelated bound cannot be parsed', () => {
    // `occurredBoundParser` already rejects `yesterday` at the URL boundary, so the state
    // `toAuditEventQueryFilters` reads never carries it - unlike the pre-fix onboardings bug,
    // where the malformed value reached the query projection unvalidated and wiped out every
    // other committed criterion.
    const state = load('actorId=ops-1&occurredFrom=yesterday');

    expect(state.occurredFrom).toBeNull();
    expect(toAuditEventQueryFilters(state)).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_SIZE,
      actorType: null,
      actorId: 'ops-1',
      action: null,
      resourceType: null,
      resourceId: null,
      occurredPeriod: null,
      occurredFrom: null,
      occurredTo: null,
    });
  });
});

describe('serializeAuditEventsSearch', () => {
  it('round-trips the criteria an operator committed', () => {
    const filters = {
      ...DEFAULT_AUDIT_EVENT_FILTERS,
      actorType: 'operator' as const,
      action: 'auth.access_granted',
      occurredPeriod: 'custom' as const,
      occurredFrom: '2026-07-01T09:00',
    };

    const query = serializeAuditEventsSearch(filters, DEFAULT_PAGE);
    const params = new URLSearchParams(query);

    expect(params.get('actorType')).toBe('operator');
    expect(params.get('action')).toBe('auth.access_granted');
    expect(params.get('occurredFrom')).toBe('2026-07-01T09:00');
    expect(params.get('occurredPeriod')).toBeNull();
    expect(params.get('occurredTo')).toBeNull();
    expect(readAuditEventFilters(query)).toEqual(filters);
  });

  it('carries a relative period instead of the instant it resolves to', () => {
    const filters = { ...DEFAULT_AUDIT_EVENT_FILTERS, occurredPeriod: '24h' as const };

    const query = serializeAuditEventsSearch(filters, DEFAULT_PAGE);

    // The link names the window, so it means the same thing whenever it is opened - which is the
    // whole point of committing the period rather than a timestamp.
    expect(query).toBe('?occurredPeriod=24h');
    expect(readAuditEventFilters(query)).toEqual(filters);
  });

  it('never states a period and a pair of bounds at once', () => {
    const query = serializeAuditEventsSearch(
      {
        ...DEFAULT_AUDIT_EVENT_FILTERS,
        occurredPeriod: '1h' as const,
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      },
      DEFAULT_PAGE,
    );
    const params = new URLSearchParams(query);

    expect(params.get('occurredPeriod')).toBe('1h');
    expect(params.get('occurredFrom')).toBeNull();
    expect(params.get('occurredTo')).toBeNull();
  });

  it('never writes `occurredPeriod=custom` into the URL', () => {
    const query = serializeAuditEventsSearch(
      {
        ...DEFAULT_AUDIT_EVENT_FILTERS,
        occurredPeriod: 'custom' as const,
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      },
      DEFAULT_PAGE,
    );

    expect(new URLSearchParams(query).get('occurredPeriod')).toBeNull();
  });

  it('carries a non-default page window', () => {
    const query = serializeAuditEventsSearch({ ...DEFAULT_AUDIT_EVENT_FILTERS, limit: 20 }, 2);
    const params = new URLSearchParams(query);

    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('20');
  });

  it('stays bare when nothing differs from the default - no page, no limit', () => {
    expect(serializeAuditEventsSearch(DEFAULT_AUDIT_EVENT_FILTERS, DEFAULT_PAGE)).toBe('');
  });

  it('produces the same committed URL and query filters whether or not a criterion carries whitespace', () => {
    const padded = {
      ...DEFAULT_AUDIT_EVENT_FILTERS,
      actorId: '  engine  ',
      action: ' onboarding.started ',
    };
    const trimmed = {
      ...DEFAULT_AUDIT_EVENT_FILTERS,
      actorId: 'engine',
      action: 'onboarding.started',
    };

    expect(serializeAuditEventsSearch(padded, DEFAULT_PAGE)).toBe(
      serializeAuditEventsSearch(trimmed, DEFAULT_PAGE),
    );

    const paddedState = toAuditEventsSearchValues(padded, DEFAULT_PAGE);
    const trimmedState = toAuditEventsSearchValues(trimmed, DEFAULT_PAGE);

    expect(toAuditEventQueryFilters(paddedState)).toEqual(toAuditEventQueryFilters(trimmedState));
  });
});
