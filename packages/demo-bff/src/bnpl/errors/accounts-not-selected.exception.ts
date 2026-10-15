import { ConflictException } from '@nestjs/common';

/** The analysis was requested before the engine recorded which accounts to analyse. */
export class AccountsNotSelectedException extends ConflictException {
  constructor() {
    super({ code: 'ACCOUNTS_NOT_SELECTED', message: 'ACCOUNTS_NOT_SELECTED' });
  }
}
