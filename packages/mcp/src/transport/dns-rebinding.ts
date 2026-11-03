/** The loopback names a client on the same machine reaches the server by. */
export const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1'];

/** What the SDK transport needs to refuse a request meant for another site. */
export interface DnsRebindingProtection {
  enableDnsRebindingProtection: true;
  allowedHosts: string[];
  allowedOrigins: string[];
}

/**
 * The `Host` and `Origin` values the server answers to: its public address plus the loopback
 * names on the port it listens on. A page on another site that DNS points at this server sends its
 * own `Host`, so the transport refuses it; a client with no `Origin` header (anything that is not
 * a browser) is not refused by the Origin check.
 */
export function buildDnsRebindingProtection(
  publicUrl: string,
  listenPort: number,
): DnsRebindingProtection {
  const { host, origin } = new URL(publicUrl);
  const loopbackHosts = LOOPBACK_HOSTNAMES.map((hostname) => `${hostname}:${listenPort}`);

  return {
    enableDnsRebindingProtection: true,
    allowedHosts: [...new Set([host, ...loopbackHosts])],
    allowedOrigins: [
      ...new Set([origin, ...loopbackHosts.map((loopback) => `http://${loopback}`)]),
    ],
  };
}

/**
 * Why a request must be refused, or `undefined` when it may pass: the same two checks the SDK
 * transport applies to `POST /mcp` (exact `Host` match; `Origin` checked only when sent), for the
 * routes that are not served by that transport.
 */
export function findDnsRebindingViolation(
  headers: { host?: string; origin?: string },
  protection: Pick<DnsRebindingProtection, 'allowedHosts' | 'allowedOrigins'>,
): string | undefined {
  if (!headers.host || !protection.allowedHosts.includes(headers.host)) {
    return `Invalid Host header: ${headers.host}`;
  }

  if (headers.origin && !protection.allowedOrigins.includes(headers.origin)) {
    return `Invalid Origin header: ${headers.origin}`;
  }

  return undefined;
}
