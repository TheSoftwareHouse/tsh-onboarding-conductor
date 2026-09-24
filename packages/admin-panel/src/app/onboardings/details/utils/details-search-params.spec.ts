import { describe, expect, it } from 'vitest';
import { serializeDetailsTab } from './details-search-params';

describe('serializeDetailsTab', () => {
  it('omits the key for the default tab', () => {
    expect(serializeDetailsTab('history', '')).toBe('');
  });

  it('carries a non-default tab', () => {
    expect(serializeDetailsTab('scores', '')).toBe('?tab=scores');
  });

  it('preserves other search params while setting tab', () => {
    expect(serializeDetailsTab('scores', '?status=awaiting_manual_review')).toBe(
      '?status=awaiting_manual_review&tab=scores',
    );
  });

  it('drops tab from the base while keeping other params, for the default tab', () => {
    expect(serializeDetailsTab('history', '?status=awaiting_manual_review&tab=scores')).toBe(
      '?status=awaiting_manual_review',
    );
  });
});
