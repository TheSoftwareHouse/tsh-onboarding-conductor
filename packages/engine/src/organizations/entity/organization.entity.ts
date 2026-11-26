import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A better-auth organization, mapped read-only from `auth."organization"`. better-auth owns the
 * table and every write to it; the engine only reads the id of the default organization. No
 * relation and no `parentId` are mapped because nothing here walks the hierarchy.
 */
@Entity({ schema: 'auth', name: 'organization' })
export class OrganizationEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'createdAt', type: 'timestamptz' })
  createdAt!: Date;
}
