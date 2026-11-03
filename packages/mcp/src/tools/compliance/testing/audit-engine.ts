import type { components } from '@tsh/openapi';
import { Masker } from '../../../masking/masker';
import { EngineClient } from '../../../engine/engine-client';
import { FieldClassLookup } from '../../../classification/field-class-lookup';
import { RequestContext } from '../../../request-context/request-context';
import { ENGINE_PAGE_SIZE } from '../../../engine/engine.constants';
import { AuditReader } from '../audit-reader';

type AuditRow = components['schemas']['AuditEventResponseDto'];

export const CONTEXT: RequestContext = {
  identity: { kind: 'user', objectId: 'oid-1', upn: 'analyst@example.com' },
  engineToken: 'engine-token-value',
};

export const MASKING_KEY = 'k'.repeat(32);

export function buildRow(overrides: Partial<AuditRow> & Pick<AuditRow, 'action'>): AuditRow {
  return {
    id: `id-${overrides.action}-${overrides.occurredAt ?? 'now'}-${overrides.actorId ?? 'actor'}`,
    occurredAt: '2026-10-15T10:00:00.000Z',
    actorType: 'operator',
    actorId: 'oid-ada',
    resourceType: 'admin_endpoint',
    resourceId: '/v1/admin/audit',
    metadata: {},
    ...overrides,
  };
}

/**
 * A stand-in for the engine's `GET /v1/admin/audit`: rows are filtered by the exact-match query
 * parameters it offers and paged by `page` and `limit`, newest first.
 */
export function buildAuditEngine(rows: readonly AuditRow[], extra?: jest.Mock) {
  const request = jest.fn((method: string, path: string, _context: RequestContext, args) => {
    if (path !== '/v1/admin/audit') {
      return extra ? extra(method, path, _context, args) : Promise.reject(new Error(path));
    }

    const { page, limit, ...filters } = args.query as Record<string, string | number | undefined>;
    const matching = rows.filter((row) =>
      Object.entries(filters).every(([name, value]) => {
        if (value === undefined) {
          return true;
        }
        if (name === 'occurredFrom') {
          return Date.parse(row.occurredAt) >= Date.parse(String(value));
        }
        if (name === 'occurredTo') {
          return Date.parse(row.occurredAt) <= Date.parse(String(value));
        }
        return (row as unknown as Record<string, unknown>)[name] === value;
      }),
    );
    const size = Number(limit);
    const start = (Number(page) - 1) * size;

    return Promise.resolve({
      items: matching.slice(start, start + size),
      meta: {
        pagination: {
          page: Number(page),
          limit: size,
          total: matching.length,
          totalPages: Math.max(1, Math.ceil(matching.length / size)),
        },
      },
    });
  });

  return request;
}

export function buildReader(
  request: jest.Mock,
  getVersionClasses: jest.Mock = jest.fn(() => Promise.resolve({ classes: new Map() })),
): AuditReader {
  return new AuditReader({ request } as unknown as EngineClient, new Masker(MASKING_KEY), {
    getVersionClasses,
  } as unknown as FieldClassLookup);
}

export const PAGE_SIZE = ENGINE_PAGE_SIZE;
