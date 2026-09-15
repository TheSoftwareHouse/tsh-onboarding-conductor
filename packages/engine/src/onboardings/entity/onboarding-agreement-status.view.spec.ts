import { QueryRunner, getMetadataArgsStorage } from 'typeorm';
import { CreateAgreements0022 } from '../../database/migrations/0022_create_agreements';
import { OnboardingAgreementStatusView } from './onboarding-agreement-status.view';

/**
 * The view exists twice: the migration creates it, and the `@ViewEntity` documents it. Only the
 * migration ever runs — `synchronize: false` keeps TypeORM from executing the entity's expression
 * — so nothing but this test stops an edit to one copy from leaving the other a lie while the
 * join keeps working off the view name.
 */
describe('OnboardingAgreementStatusView', () => {
  const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

  const runMigration = async (): Promise<string[]> => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => {
        statements.push(sql);
      },
    } as unknown as QueryRunner;

    await new CreateAgreements0022().up(queryRunner);

    return statements;
  };

  it('declares the expression the migration creates the view with', async () => {
    const statements = await runMigration();
    const createView = statements.find((statement) =>
      statement.includes('CREATE VIEW onboarding_agreement_statuses'),
    );
    const declared = getMetadataArgsStorage().tables.find(
      (table) => table.target === OnboardingAgreementStatusView,
    )?.expression;

    expect(createView).toBeDefined();
    expect(typeof declared).toBe('string');
    expect(normalize(declared as string)).toBe(
      normalize((createView as string).replace('CREATE VIEW onboarding_agreement_statuses AS', '')),
    );
  });
});
