import { describe, expect, it } from 'vitest';
import {
  buildFilterSearchParams,
  readEnumParam,
  readPageParam,
  readPageSizeParam,
  readTextParam,
} from './filter-search-params';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from './pagination';

const COLOURS = ['red', 'blue'] as const;

function isColour(value: string): value is (typeof COLOURS)[number] {
  return (COLOURS as readonly string[]).includes(value);
}

describe('readTextParam', () => {
  it('trims the carried value', () => {
    expect(readTextParam(new URLSearchParams('workflowId=  kyc-basic  '), 'workflowId')).toBe(
      'kyc-basic',
    );
  });

  it('reads a missing criterion as not applied', () => {
    expect(readTextParam(new URLSearchParams(''), 'workflowId')).toBe('');
  });
});

describe('readEnumParam', () => {
  it('keeps a value the build recognizes', () => {
    expect(readEnumParam(new URLSearchParams('colour=blue'), 'colour', isColour)).toBe('blue');
  });

  it('falls back to "All" for a value the endpoint would refuse', () => {
    expect(readEnumParam(new URLSearchParams('colour=beige'), 'colour', isColour)).toBe('');
  });
});

describe('readPageParam', () => {
  it('reads the page the URL names', () => {
    expect(readPageParam(new URLSearchParams('page=4'))).toBe(4);
  });

  it.each(['0', '-2', '1.5', 'two', '', '99999999999999999999'])(
    'falls back to the first page for %j, which names no page',
    (value) => {
      expect(readPageParam(new URLSearchParams(`page=${value}`))).toBe(DEFAULT_PAGE);
    },
  );
});

describe('readPageSizeParam', () => {
  it('reads a size the panel offers', () => {
    expect(readPageSizeParam(new URLSearchParams('limit=20'))).toBe(20);
  });

  it('falls back to the default for a size the panel does not offer', () => {
    expect(readPageSizeParam(new URLSearchParams('limit=7'))).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('buildFilterSearchParams', () => {
  it('carries the criteria that narrow the list and leaves out the blank ones', () => {
    const params = buildFilterSearchParams(
      { status: 'approved', workflowId: '' },
      DEFAULT_PAGE,
      DEFAULT_PAGE_SIZE,
    );

    expect(params.toString()).toBe('status=approved');
  });

  it('states the page window only where it differs from the default', () => {
    expect(buildFilterSearchParams({}, 3, 20).toString()).toBe('page=3&limit=20');
    expect(buildFilterSearchParams({}, DEFAULT_PAGE, DEFAULT_PAGE_SIZE).toString()).toBe('');
  });
});
