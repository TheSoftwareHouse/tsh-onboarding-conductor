/**
 * The SSO provider whose access tokens the engine accepts on the admin endpoints, selected with
 * `ADMIN_SSO_PROVIDER`.
 *
 * Only Microsoft Entra ID is implemented today. The switch exists so moving the deployment to a
 * different directory — Google Workspace, say — is a configuration change plus one new verifier,
 * rather than an edit spread across the config, the module wiring and the request path. Adding a
 * provider means: a member here, its required settings in `validateConfig`, and an entry in the
 * verifier registry in `auth.module.ts`. Nothing else looks at which directory issued a token.
 */
export enum SsoProvider {
  AZURE = 'azure',
}

export const SUPPORTED_SSO_PROVIDERS: readonly SsoProvider[] = Object.values(SsoProvider);

/** Chosen when `ADMIN_SSO_PROVIDER` is unset, so an existing deployment keeps its behaviour. */
export const DEFAULT_SSO_PROVIDER = SsoProvider.AZURE;
