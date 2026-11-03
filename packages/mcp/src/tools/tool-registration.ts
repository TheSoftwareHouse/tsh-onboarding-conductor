import { DiscoveryService } from '@nestjs/core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { RequestContext } from '../request-context/request-context';

export const ToolKind = { READ: 'read', WRITE: 'write' } as const;
export type ToolKind = (typeof ToolKind)[keyof typeof ToolKind];

export type ToolInputSchema = Tool['inputSchema'];

/** The arguments exactly as the client sent them; a handler validates what it reads. */
export type ToolArguments = Record<string, unknown>;

/**
 * What an area module provides for each tool: a class implementing this and marked `@McpTool()`.
 * The registry finds it by that mark, so adding a tool never touches the registry or the
 * `ToolsModule`. A handler returns the object the model reads, throws a `ToolError` for a refusal
 * the model can act on, and reads the caller and engine token from `context`.
 */
export interface ToolRegistration {
  readonly kind: ToolKind;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  handler(args: ToolArguments, context: RequestContext): Promise<object>;
}

export const McpTool = DiscoveryService.createDecorator<void>();
