import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { AUDIT_ACTOR_TYPES, type AuditEventQueryFilters } from '@/api/audit/audit-events';
import type { AuditEventsSearchValues } from './audit-events-search-params';
import {
  countActiveAuditFilters,
  DEFAULT_AUDIT_EVENT_FILTERS,
  findOccurredWindowError,
  OCCURRED_AT_ERROR_MESSAGE,
  OCCURRED_RANGE_ERROR_MESSAGE,
  toAuditEventQueryFilters,
} from './filter-audit-events';

/** The instant a `datetime-local` value denotes, resolved in whatever zone the test runs in. */
function isoInstant(controlValue: string): string {
  return new Date(controlValue).toISOString();
}

/** The search state a bare URL reads as: every criterion absent, page and limit at their defaults. */
const DEFAULT_SEARCH_VALUES: AuditEventsSearchValues = {
  actorType: null,
  actorId: null,
  action: null,
  resourceType: null,
  resourceId: null,
  occurredPeriod: null,
  occurredFrom: null,
  occurredTo: null,
  limit: DEFAULT_PAGE_SIZE,
  page: DEFAULT_PAGE,
};

/** The query filters an all-absent state maps to - every criterion `null`. */
const DEFAULT_QUERY_FILTERS: AuditEventQueryFilters = {
  page: DEFAULT_PAGE,
  limit: DEFAULT_PAGE_SIZE,
  actorType: null,
  actorId: null,
  action: null,
  resourceType: null,
  resourceId: null,
  occurredPeriod: null,
  occurredFrom: null,
  occurredTo: null,
};

describe('toAuditEventQueryFilters', () => {
  it('passes a relative period through unresolved, leaving the bounds out entirely', () => {
    const result = toAuditEventQueryFilters({ ...DEFAULT_SEARCH_VALUES, occurredPeriod: '7d' });

    expect(result).toEqual({ ...DEFAULT_QUERY_FILTERS, occurredPeriod: '7d' });
  });

  it('ignores bounds left behind under a period, so only one window can ever apply', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      occurredPeriod: '1h',
      occurredFrom: '2026-07-02T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    // The bounds are the wrong way round, which would be dropped under `custom` - under a period
    // they are not read at all, so they cannot disturb a window the operator did not ask for.
    expect(result.occurredPeriod).toBe('1h');
    expect(result.occurredFrom).toBeNull();
    expect(result.occurredTo).toBeNull();
  });

  it('ignores an unparseable bound left behind under a period', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      occurredPeriod: '24h',
      occurredFrom: '2026-13-45T99:99',
    });

    // The draft keeps whatever was half-typed into the bounds when the operator switched to a
    // relative period. Parsing those bounds per field would refuse a window they did ask for, so
    // a period must short-circuit the conversion, not merely drop its result.
    expect(result).toEqual({ ...DEFAULT_QUERY_FILTERS, occurredPeriod: '24h' });
  });

  it('maps an all-absent state to a query with every criterion null', () => {
    const result = toAuditEventQueryFilters(DEFAULT_SEARCH_VALUES);

    expect(result).toEqual(DEFAULT_QUERY_FILTERS);
  });

  it.each(AUDIT_ACTOR_TYPES)('forwards the %s actor type as a query filter', (actorType) => {
    const result = toAuditEventQueryFilters({ ...DEFAULT_SEARCH_VALUES, actorType });

    expect(result).toEqual({ ...DEFAULT_QUERY_FILTERS, actorType });
  });

  it('carries the requested page and page size through to the endpoint', () => {
    const result = toAuditEventQueryFilters({ ...DEFAULT_SEARCH_VALUES, page: 3, limit: 100 });

    expect(result).toEqual({ ...DEFAULT_QUERY_FILTERS, page: 3, limit: 100 });
  });

  it('converts the local datetime controls into the ISO-8601 instants the endpoint accepts', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      occurredFrom: '2026-07-01T09:00',
      occurredTo: '2026-07-02T17:30',
    });

    expect(result).toEqual({
      ...DEFAULT_QUERY_FILTERS,
      occurredFrom: isoInstant('2026-07-01T09:00'),
      occurredTo: isoInstant('2026-07-02T17:30'),
    });
  });

  it('accepts a window whose bounds are the same instant', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      occurredFrom: '2026-07-01T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    expect(result.occurredFrom).not.toBeNull();
    expect(result.occurredTo).not.toBeNull();
  });

  it('drops a window that runs backwards while every other criterion still applies', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      actorId: 'ops-1',
      occurredFrom: '2026-07-02T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    // A refused window narrows nothing, so it falls back to absent like any other criterion the
    // URL states badly - it must not unfilter the whole trail. The page reports it separately,
    // through `findOccurredWindowError`.
    expect(result.actorId).toBe('ops-1');
    expect(result.occurredFrom).toBeNull();
    expect(result.occurredTo).toBeNull();
  });

  it('drops a datetime it cannot resolve to an instant, keeping the rest', () => {
    const result = toAuditEventQueryFilters({
      ...DEFAULT_SEARCH_VALUES,
      action: 'onboarding.started',
      occurredFrom: 'not-a-datetime',
    });

    expect(result).toEqual({ ...DEFAULT_QUERY_FILTERS, action: 'onboarding.started' });
  });
});

describe('findOccurredWindowError', () => {
  const draft = { ...DEFAULT_AUDIT_EVENT_FILTERS };

  it('reports nothing for a window the operator has not stated', () => {
    expect(findOccurredWindowError(draft)).toBeNull();
  });

  it('reports nothing under a relative period, whatever the bounds still hold', () => {
    // The draft keeps whatever was half-typed when the operator switched to a period, so reading
    // the bounds here would refuse a window they did ask for.
    expect(
      findOccurredWindowError({
        ...draft,
        occurredPeriod: '24h',
        occurredFrom: '2026-13-45T99:99',
      }),
    ).toBeNull();
  });

  it('reports a bound the browser could not have produced', () => {
    expect(findOccurredWindowError({ ...draft, occurredFrom: 'not-a-datetime' })).toBe(
      OCCURRED_AT_ERROR_MESSAGE,
    );
  });

  it('reports a window that runs backwards', () => {
    expect(
      findOccurredWindowError({
        ...draft,
        occurredFrom: '2026-07-02T09:00',
        occurredTo: '2026-07-01T09:00',
      }),
    ).toBe(OCCURRED_RANGE_ERROR_MESSAGE);
  });

  it('reports nothing once the window is corrected', () => {
    expect(
      findOccurredWindowError({
        ...draft,
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      }),
    ).toBeNull();
  });

  it('ignores whitespace around a bound, as the commit boundary does', () => {
    expect(findOccurredWindowError({ ...draft, occurredFrom: '   ' })).toBeNull();
  });
});

describe('countActiveAuditFilters', () => {
  it('counts a relative period, which is the whole window on its own', () => {
    expect(countActiveAuditFilters({ ...DEFAULT_SEARCH_VALUES, occurredPeriod: '24h' })).toBe(1);
  });

  it('counts a custom window once per bound, not once more for the mode', () => {
    // `custom` is never a value `occurredPeriod` carries in this shape - it is `null` with the two
    // bounds filled in, so only the bounds that are actually present count.
    expect(
      countActiveAuditFilters({
        ...DEFAULT_SEARCH_VALUES,
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      }),
    ).toBe(2);
  });

  it('counts nothing for an all-absent state', () => {
    // Opening `Custom range…` with no bounds typed yet narrows nothing, and is indistinguishable
    // from no window at all in this shape - both are `occurredPeriod: null` with no bounds.
    expect(countActiveAuditFilters(DEFAULT_SEARCH_VALUES)).toBe(0);
  });

  it('never counts the page window, however far from the default', () => {
    expect(countActiveAuditFilters({ ...DEFAULT_SEARCH_VALUES, page: 3, limit: 20 })).toBe(0);
  });
});
