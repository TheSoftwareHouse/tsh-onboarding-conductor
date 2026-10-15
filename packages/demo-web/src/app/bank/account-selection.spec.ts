import { describe, expect, it } from 'vitest';

import { accountSelectionSchema, selectionMessage, toggle } from './account-selection';

describe('account selection', () => {
  it('should reject an empty selection', () => {
    const result = accountSelectionSchema.safeParse({ selectedAccounts: [] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Select at least one account');
  });

  it('should accept a selection of one account', () => {
    expect(accountSelectionSchema.safeParse({ selectedAccounts: ['account-02'] }).success).toBe(
      true,
    );
  });

  it('should explain the BFF code when the current account is missing', () => {
    expect(selectionMessage(['CHECKING_ACCOUNT_REQUIRED'])).toContain('current account');
    expect(selectionMessage(['SOMETHING_ELSE'])).toBe('SOMETHING_ELSE');
  });

  it('should add and remove an id when toggling', () => {
    expect(toggle(['account-01'], 'account-02', true)).toEqual(['account-01', 'account-02']);
    expect(toggle(['account-01', 'account-02'], 'account-01', false)).toEqual(['account-02']);
  });
});
