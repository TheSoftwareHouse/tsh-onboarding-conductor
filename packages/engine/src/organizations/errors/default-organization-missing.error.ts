/**
 * `auth."organization"` holds no row, so there is no default organization to own a new record.
 * Migration `0004` inserts one, so this means the table was emptied after the migration ran.
 */
export class DefaultOrganizationMissingError extends Error {
  constructor() {
    super('No organization exists, so the engine has no default organization to assign.');
    this.name = 'DefaultOrganizationMissingError';
  }
}
