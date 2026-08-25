/**
 * `http_request` secrets, nested by alias: `{{secrets.<alias>.<key>}}` resolves against
 * `secrets[<alias>][<key>]`. Stored settings hold the flat-dotted form (`<alias>.<key>`); see
 * `HttpRequestConnector`'s `expandStoredSecrets` for the expansion between the two shapes.
 */
export type HttpConnectorSecrets = Readonly<Record<string, Readonly<Record<string, string>>>>;
