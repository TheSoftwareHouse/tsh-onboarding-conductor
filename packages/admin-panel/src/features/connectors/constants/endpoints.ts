export const CONNECTOR_ENDPOINTS = {
  adminConnectors: '/v1/admin/connectors',
} as const;

/** Path to one connector's settings resource, used by both the replace and clear requests. */
export function connectorSettingsPath(connectorId: string): string {
  return `${CONNECTOR_ENDPOINTS.adminConnectors}/${encodeURIComponent(connectorId)}`;
}
