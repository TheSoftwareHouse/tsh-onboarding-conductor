import { describe, expect, it } from 'vitest';
import { stripDetailsParams, workflowDetailsSearchParams } from './workflow-details-search-params';

describe('workflowDetailsSearchParams.view', () => {
  const { view } = workflowDetailsSearchParams;

  it.each(['authored', 'compiled', 'json'])('parses %s', (value) => {
    expect(view.parse(value)).toBe(value);
  });

  it.each(['table', '', 'GRAPH'])('parses %j to null', (value) => {
    expect(view.parse(value)).toBeNull();
  });
});

describe('stripDetailsParams', () => {
  it('drops version, step and view and keeps the list params', () => {
    expect(stripDetailsParams('?q=kyc&version=2&step=review&view=json&status=draft')).toBe(
      '?q=kyc&status=draft',
    );
  });

  it('returns an empty string when nothing else remains', () => {
    expect(stripDetailsParams('?version=2&step=review&view=compiled')).toBe('');
  });
});
