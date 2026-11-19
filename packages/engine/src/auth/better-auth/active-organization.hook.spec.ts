import { findActiveOrganizationId } from './active-organization.hook';

describe('findActiveOrganizationId', () => {
  it('sets the first membership when the session has no active organization', async () => {
    const lookups = { findFirstOrganizationId: jest.fn().mockResolvedValue('org-1') };

    await expect(findActiveOrganizationId({ userId: 'u1' }, lookups)).resolves.toBe('org-1');
    expect(lookups.findFirstOrganizationId).toHaveBeenCalledWith('u1');
  });

  it('leaves an existing active organization alone', async () => {
    const lookups = { findFirstOrganizationId: jest.fn() };

    await expect(
      findActiveOrganizationId({ userId: 'u1', activeOrganizationId: 'org-9' }, lookups),
    ).resolves.toBeNull();
    expect(lookups.findFirstOrganizationId).not.toHaveBeenCalled();
  });

  it('returns null for a user with no membership', async () => {
    const lookups = { findFirstOrganizationId: jest.fn().mockResolvedValue(null) };

    await expect(findActiveOrganizationId({ userId: 'u1' }, lookups)).resolves.toBeNull();
  });
});
