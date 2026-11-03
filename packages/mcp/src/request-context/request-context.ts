import type { Request } from 'express';

export const LOCAL_IDENTITY_ID = 'local';

export type CallerIdentity = { kind: 'local' } | { kind: 'user'; objectId: string; upn: string };

/**
 * What one MCP request carries to the tools: who is calling and, when authentication is on, the
 * token the engine must receive on their behalf. A tool never reads a header itself.
 */
export interface RequestContext {
  identity: CallerIdentity;
  engineToken?: string;
}

/** A request that authentication has already resolved; absent until it runs. */
export type McpRequest = Request & { mcpContext?: RequestContext };

export const LOCAL_REQUEST_CONTEXT: RequestContext = { identity: { kind: 'local' } };

/** The stable key of a caller for logs and per-caller limits: the object id, or `local`. */
export function getIdentityId(identity: CallerIdentity): string {
  return identity.kind === 'user' ? identity.objectId : LOCAL_IDENTITY_ID;
}
