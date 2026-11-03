/** The only hosts the seeder will open a database connection to. */
export const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', 'postgres'] as const;

/**
 * Refuses a connection string whose host is not a local development database, so the seeder can
 * never read from or rewrite a shared environment. The message names the host, never the
 * credentials.
 */
export function assertLocalDatabaseHost(databaseUrl: string): void {
  const host = parseHost(databaseUrl);

  if (!(LOCAL_DATABASE_HOSTS as readonly string[]).includes(host)) {
    throw new Error(
      `Refusing to use database host "${host}": the seeder only runs against ${LOCAL_DATABASE_HOSTS.join(', ')}.`,
    );
  }
}

function parseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
}
