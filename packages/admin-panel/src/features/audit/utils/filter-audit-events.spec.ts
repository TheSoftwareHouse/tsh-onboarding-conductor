import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { AUDIT_ACTOR_TYPES } from '../types/audit-event';
import { createDefaultAuditEventFilters } from './audit-events-query';
import {
  countActiveAuditFilters,
  normalizeAuditEventFilters,
  OCCURRED_AT_ERROR_MESSAGE,
  OCCURRED_RANGE_ERROR_MESSAGE,
} from './filter-audit-events';

/** The instant a `datetime-local` value denotes, resolved in whatever zone the test runs in. */
function isoInstant(controlValue: string): string {
  return new Date(controlValue).toISOString();
}

describe('normalizeAuditEventFilters', () => {
  it('passes a relative period through unresolved, leaving the bounds out entirely', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredPeriod: '7d',
    });

    expect(result).toEqual({ ok: true, filters: { page: 1, limit: 100, occurredPeriod: '7d' } });
  });

  it('ignores bounds left behind under a period, so only one window can ever apply', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredPeriod: '1h',
      occurredFrom: '2026-07-02T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    // The bounds are the wrong way round, which would be refused under `custom` - under a period
    // they are not read at all, so they cannot refuse a window the operator did not ask for.
    expect(result.ok).toBe(true);
  });

  it('omits blank and whitespace-only criteria, keeping only the page window', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      actorId: '   ',
      action: '\n\t',
      resourceType: ' ',
    });

    expect(result).toEqual({ ok: true, filters: { page: 1, limit: DEFAULT_PAGE_SIZE } });
  });

  it.each(AUDIT_ACTOR_TYPES)('forwards the %s actor type as a query filter', (actorType) => {
    const result = normalizeAuditEventFilters({ ...createDefaultAuditEventFilters(), actorType });

    expect(result).toEqual({ ok: true, filters: { page: 1, limit: DEFAULT_PAGE_SIZE, actorType } });
  });

  it('trims the free-text criteria the endpoint matches exactly', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      actorId: '  engine  ',
      action: ' onboarding.started ',
      resourceType: ' onboarding ',
      resourceId: ' 018f1e2a-1111-7000-8000-000000000001 ',
    });

    expect(result).toEqual({
      ok: true,
      filters: {
        page: 1,
        limit: DEFAULT_PAGE_SIZE,
        actorId: 'engine',
        action: 'onboarding.started',
        resourceType: 'onboarding',
        resourceId: '018f1e2a-1111-7000-8000-000000000001',
      },
    });
  });

  it('carries the requested page and page size through to the endpoint', () => {
    const result = normalizeAuditEventFilters(
      { ...createDefaultAuditEventFilters(), limit: 100 },
      3,
    );

    expect(result).toEqual({ ok: true, filters: { page: 3, limit: 100 } });
  });

  it('converts the local datetime controls into the ISO-8601 instants the endpoint accepts', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredFrom: '2026-07-01T09:00',
      occurredTo: '2026-07-02T17:30',
    });

    expect(result).toEqual({
      ok: true,
      filters: {
        page: 1,
        limit: DEFAULT_PAGE_SIZE,
        occurredFrom: isoInstant('2026-07-01T09:00'),
        occurredTo: isoInstant('2026-07-02T17:30'),
      },
    });
  });

  it('accepts a window whose bounds are the same instant', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredFrom: '2026-07-01T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a window that runs backwards, which would always return nothing', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredFrom: '2026-07-02T09:00',
      occurredTo: '2026-07-01T09:00',
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: 'invalid-occurred-range', message: OCCURRED_RANGE_ERROR_MESSAGE },
    });
  });

  it('refuses a datetime it cannot resolve to an instant', () => {
    const result = normalizeAuditEventFilters({
      ...createDefaultAuditEventFilters(),
      occurredFrom: 'not-a-datetime',
    });

    expect(result).toEqual({
      ok: false,
      error: { reason: 'invalid-occurred-at', message: OCCURRED_AT_ERROR_MESSAGE },
    });
  });
});

describe('countActiveAuditFilters', () => {
  it('counts a relative period, which is the whole window on its own', () => {
    expect(
      countActiveAuditFilters({ ...createDefaultAuditEventFilters(), occurredPeriod: '24h' }),
    ).toBe(1);
  });

  it('counts a custom window once per bound, not once more for the mode', () => {
    expect(
      countActiveAuditFilters({
        ...createDefaultAuditEventFilters(),
        occurredPeriod: 'custom',
        occurredFrom: '2026-07-01T09:00',
        occurredTo: '2026-07-02T09:00',
      }),
    ).toBe(2);
  });

  it('counts nothing for a custom window with no bounds entered yet', () => {
    // Opening `Custom range…` narrows nothing, so the band must not claim an active filter.
    expect(
      countActiveAuditFilters({ ...createDefaultAuditEventFilters(), occurredPeriod: 'custom' }),
    ).toBe(0);
  });

  it('never counts the page window', () => {
    expect(countActiveAuditFilters(createDefaultAuditEventFilters())).toBe(0);
  });
});
