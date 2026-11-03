import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '@nestjs/core';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ToolCallAudit, ToolCallOutcome } from '../audit/tool-call-audit';
import { ToolLimits, ToolRateLimitError } from '../limits/tool-limits';
import { RequestContext } from '../request-context/request-context';
import { assertKnownArguments } from './shared/tool-arguments';
import { ToolError } from './tool-error';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from './tool-registration';

interface ToolRun {
  text: string;
  isError: boolean;
  outcome: ToolCallOutcome;
}

/** Every `@McpTool()` provider, filtered by `MCP_WRITE_TOOLS_ENABLED`, behind list and call. */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private tools?: Map<string, ToolRegistration>;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly config: ConfigService,
    private readonly limits: ToolLimits,
    private readonly audit: ToolCallAudit,
  ) {}

  listTools(): Tool[] {
    return [...this.getTools().values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.kind === ToolKind.WRITE
        ? { annotations: { destructiveHint: true, idempotentHint: false } }
        : {}),
    }));
  }

  async callTool(
    name: string,
    args: ToolArguments | undefined,
    context: RequestContext,
  ): Promise<CallToolResult> {
    const startedAt = Date.now();
    const tool = this.getTools().get(name);
    const argumentKeys = Object.keys(args ?? {});

    if (!tool) {
      this.audit.record(context, {
        tool: name,
        argumentKeys,
        resultBytes: 0,
        durationMs: Date.now() - startedAt,
        outcome: ToolCallOutcome.UNKNOWN_TOOL,
      });
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }

    const { text, isError, outcome } = await this.runTool(tool, args ?? {}, context);

    this.audit.record(context, {
      tool: name,
      argumentKeys,
      resultBytes: Buffer.byteLength(text, 'utf8'),
      durationMs: Date.now() - startedAt,
      outcome,
    });

    return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) };
  }

  private async runTool(
    tool: ToolRegistration,
    args: ToolArguments,
    context: RequestContext,
  ): Promise<ToolRun> {
    try {
      this.limits.consumeToolCall(context.identity);
      if (tool.inputSchema.additionalProperties === false) {
        assertKnownArguments(args, tool.inputSchema);
      }
      const output = await tool.handler(args, context);

      return { text: JSON.stringify(output), isError: false, outcome: ToolCallOutcome.SUCCESS };
    } catch (error) {
      if (error instanceof ToolError) {
        return {
          text: error.message,
          isError: true,
          outcome:
            error instanceof ToolRateLimitError
              ? ToolCallOutcome.RATE_LIMITED
              : ToolCallOutcome.ERROR,
        };
      }

      this.logger.error(`Tool ${tool.name} failed unexpectedly`, (error as Error).stack);
      return {
        text: 'The tool failed unexpectedly. Try again later.',
        isError: true,
        outcome: ToolCallOutcome.ERROR,
      };
    }
  }

  private getTools(): Map<string, ToolRegistration> {
    if (this.tools) {
      return this.tools;
    }

    const writeEnabled = this.config.getOrThrow<boolean>('MCP_WRITE_TOOLS_ENABLED');
    const tools = new Map<string, ToolRegistration>();

    for (const provider of this.discovery.getProviders({ metadataKey: McpTool.KEY })) {
      const tool = provider.instance as ToolRegistration;

      if (tools.has(tool.name)) {
        throw new Error(`Two MCP tools are registered under the name ${tool.name}`);
      }
      if (tool.kind === ToolKind.READ || writeEnabled) {
        tools.set(tool.name, tool);
      }
    }

    this.tools = tools;
    return tools;
  }
}
