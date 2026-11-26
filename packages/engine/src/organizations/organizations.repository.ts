import { EntityManager } from 'typeorm';
import { OrganizationEntity } from './entity/organization.entity';
import { DefaultOrganizationMissingError } from './errors/default-organization-missing.error';

export class OrganizationsRepository {
  /** The default organization is the oldest one by `("createdAt", id)`. */
  async getDefaultId(manager: EntityManager): Promise<string> {
    const oldest = await manager.getRepository(OrganizationEntity).findOne({
      select: { id: true },
      where: {},
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    if (!oldest) {
      throw new DefaultOrganizationMissingError();
    }

    return oldest.id;
  }
}
