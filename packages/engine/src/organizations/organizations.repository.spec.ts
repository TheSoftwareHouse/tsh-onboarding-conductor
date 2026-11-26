import { EntityManager } from 'typeorm';
import { OrganizationEntity } from './entity/organization.entity';
import { DefaultOrganizationMissingError } from './errors/default-organization-missing.error';
import { OrganizationsRepository } from './organizations.repository';

describe('OrganizationsRepository', () => {
  const createdAt = new Date('2026-09-01T10:00:00.000Z');

  /**
   * An in-memory `auth."organization"` whose `findOne` honours the `order` it is given, so the
   * spec proves the ordering the repository asks for rather than a canned answer.
   */
  const createHarness = (rows: Array<{ id: string; createdAt: Date }>) => {
    const findOne = jest.fn(
      async (options: {
        order: { createdAt: 'ASC'; id: 'ASC' };
      }): Promise<{ id: string } | null> => {
        expect(options.order).toEqual({ createdAt: 'ASC', id: 'ASC' });

        const sorted = [...rows].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
        );

        return sorted[0] ?? null;
      },
    );
    const getRepository = jest.fn().mockReturnValue({ findOne });
    const manager = { getRepository } as unknown as EntityManager;

    return { sut: new OrganizationsRepository(), manager, getRepository };
  };

  it('returns the oldest organization', async () => {
    const { sut, manager, getRepository } = createHarness([
      { id: 'newer', createdAt: new Date('2026-10-01T10:00:00.000Z') },
      { id: 'oldest', createdAt },
    ]);

    await expect(sut.getDefaultId(manager)).resolves.toBe('oldest');
    expect(getRepository).toHaveBeenCalledWith(OrganizationEntity);
  });

  it('breaks a createdAt tie by the lower id', async () => {
    const { sut, manager } = createHarness([
      { id: 'b-org', createdAt },
      { id: 'a-org', createdAt },
    ]);

    await expect(sut.getDefaultId(manager)).resolves.toBe('a-org');
  });

  it('throws when no organization exists', async () => {
    const { sut, manager } = createHarness([]);

    await expect(sut.getDefaultId(manager)).rejects.toBeInstanceOf(DefaultOrganizationMissingError);
  });
});
