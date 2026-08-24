import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { AUDIT_ACTOR_TYPES } from '../types/audit-event';
import { createDefaultAuditEventFilters } from './audit-events-query';
import {
  normalizeAuditEventFilters,
  OCCURRED_AT_ERROR_MESSAGE,
  OCCURRED_RANGE_ERROR_MESSAGE,
} from './filter-audit-events';

/** The instant a `datetime-local` value denotes, resolved in whatever zone the test runs in. */
function isoInstant(controlValue: string): string {
  return new Date(controlValue).toISOString();
}

describe('normalizeAuditEventFilters', () => {
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
