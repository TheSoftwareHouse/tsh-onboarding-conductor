export const ENTRA_AUTHORITY_HOST = 'https://login.microsoftonline.com';

export function buildEntraAuthority(tenantId: string): string {
  return `${ENTRA_AUTHORITY_HOST}/${tenantId}`;
}

export function buildEntraIssuer(tenantId: string): string {
  return `${buildEntraAuthority(tenantId)}/v2.0`;
}

export function buildEntraJwksUrl(tenantId: string): URL {
  return new URL(`${buildEntraAuthority(tenantId)}/discovery/v2.0/keys`);
}
