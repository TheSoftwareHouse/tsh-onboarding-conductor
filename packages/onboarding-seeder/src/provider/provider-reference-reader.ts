import { Pool } from 'pg';
import { assertLocalDatabaseHost } from '../database/local-database-guard';

const PROVIDER_REFERENCE_POOL_SIZE = 2;

/**
 * Reads `pending_connector->>'providerReference'`, the correlation id the mock identity provider
 * needs to call back and which no engine API exposes. It is the seeder's only database access, it
 * is read-only, and it refuses a host that is not local.
 */
export class ProviderReferenceReader {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    assertLocalDatabaseHost(databaseUrl);
    this.pool = new Pool({ connectionString: databaseUrl, max: PROVIDER_REFERENCE_POOL_SIZE });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getProviderReference(onboardingId: string): Promise<string> {
    const result = await this.pool.query<{ provider_reference: string | null }>(
      "select pending_connector->>'providerReference' as provider_reference from onboardings where id = $1",
      [onboardingId],
    );
    const reference = result.rows[0]?.provider_reference;

    if (!reference) {
      throw new Error(`Onboarding ${onboardingId} has no pending connector to call back.`);
    }

    return reference;
  }
}
