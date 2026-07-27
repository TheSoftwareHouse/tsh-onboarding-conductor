export function validateAdminPanelOrigin(origin: string): string {
  const trimmedOrigin = origin.trim();

  if (trimmedOrigin === '') {
    throw new Error('ADMIN_PANEL_ORIGIN must be a non-empty absolute http(s) origin');
  }

  const adminPanelOriginError =
    'ADMIN_PANEL_ORIGIN must be an absolute http(s) origin without a path, query, fragment, credentials, or trailing slash';

  const parsedOrigin = new URL(trimmedOrigin);

  const hasValidProtocol = parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:';
  const hasCredentials = Boolean(parsedOrigin.username || parsedOrigin.password);
  const hasNonRootPath = parsedOrigin.pathname !== '/';
  const hasSearchOrFragment = Boolean(parsedOrigin.search || parsedOrigin.hash);
  const hasTrailingSlash = trimmedOrigin.endsWith('/');

  if (
    !hasValidProtocol ||
    hasCredentials ||
    hasNonRootPath ||
    hasSearchOrFragment ||
    hasTrailingSlash
  ) {
    throw new Error(adminPanelOriginError);
  }

  return trimmedOrigin;
}
