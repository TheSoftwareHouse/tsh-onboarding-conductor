import { assertLocalDatabaseHost } from './local-database-guard';

describe('assertLocalDatabaseHost', () => {
  it.each(['localhost', '127.0.0.1', 'postgres'])('accepts %s', (host) => {
    expect(() =>
      assertLocalDatabaseHost(`postgres://user:secret@${host}:5432/orchestrator`),
    ).not.toThrow();
  });

  it('refuses a remote host and names the host but not the credentials', () => {
    const attempt = () =>
      assertLocalDatabaseHost('postgres://user:secret@db.example.org:5432/orchestrator');

    expect(attempt).toThrow('db.example.org');
    expect(attempt).not.toThrow(/secret/);
  });

  it('refuses a host that merely starts with a local name', () => {
    expect(() => assertLocalDatabaseHost('postgres://user:pw@localhost.evil.test/db')).toThrow();
  });

  it('refuses a string that is not a URL', () => {
    expect(() => assertLocalDatabaseHost('not a url')).toThrow('not a valid connection URL');
  });
});
