import { buildDnsRebindingProtection, findDnsRebindingViolation } from './dns-rebinding';

describe('buildDnsRebindingProtection', () => {
  it('allows the public address and the loopback names on the listen port', () => {
    expect(buildDnsRebindingProtection('https://mcp.example.com', 3100)).toEqual({
      enableDnsRebindingProtection: true,
      allowedHosts: ['mcp.example.com', 'localhost:3100', '127.0.0.1:3100'],
      allowedOrigins: ['https://mcp.example.com', 'http://localhost:3100', 'http://127.0.0.1:3100'],
    });
  });

  it('keeps a non-default public port in the host and the origin', () => {
    const { allowedHosts, allowedOrigins } = buildDnsRebindingProtection(
      'http://localhost:3101/',
      3100,
    );

    expect(allowedHosts).toEqual(['localhost:3101', 'localhost:3100', '127.0.0.1:3100']);
    expect(allowedOrigins).toEqual([
      'http://localhost:3101',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    ]);
  });

  it('lists a loopback public address once', () => {
    const { allowedHosts } = buildDnsRebindingProtection('http://localhost:3100', 3100);

    expect(allowedHosts).toEqual(['localhost:3100', '127.0.0.1:3100']);
  });
});

describe('findDnsRebindingViolation', () => {
  const protection = buildDnsRebindingProtection('https://mcp.example.com', 3100);

  it('lets the public host and the loopback names through, with no Origin', () => {
    expect(findDnsRebindingViolation({ host: 'mcp.example.com' }, protection)).toBeUndefined();
    expect(findDnsRebindingViolation({ host: 'localhost:3100' }, protection)).toBeUndefined();
  });

  it('lets an allowed Origin through', () => {
    expect(
      findDnsRebindingViolation(
        { host: 'mcp.example.com', origin: 'https://mcp.example.com' },
        protection,
      ),
    ).toBeUndefined();
  });

  it('refuses a missing or foreign Host', () => {
    expect(findDnsRebindingViolation({}, protection)).toMatch(/Invalid Host header/);
    expect(findDnsRebindingViolation({ host: 'evil.example' }, protection)).toMatch(
      /Invalid Host header: evil.example/,
    );
  });

  it('refuses a foreign Origin even on an allowed Host', () => {
    expect(
      findDnsRebindingViolation(
        { host: 'mcp.example.com', origin: 'https://evil.example' },
        protection,
      ),
    ).toMatch(/Invalid Origin header/);
  });
});
