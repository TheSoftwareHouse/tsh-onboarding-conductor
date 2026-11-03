import {
  Controller,
  Delete,
  Get,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Response } from 'express';
import {
  LOCAL_REQUEST_CONTEXT,
  McpRequest,
  RequestContext,
} from '../request-context/request-context';
import { ToolRegistry } from '../tools/tool-registry';
import { buildDnsRebindingProtection, DnsRebindingProtection } from './dns-rebinding';
import { SERVER_INFO } from './server-info';

const JSON_RPC_SERVER_ERROR = -32000;

/**
 * Stateless Streamable HTTP: every POST gets its own server and transport, answers with a JSON
 * body and is torn down when the response closes, so no analyst's session outlives their request.
 */
@Controller('mcp')
export class McpController {
  private readonly rebindingProtection: DnsRebindingProtection;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly config: ConfigService,
  ) {
    this.rebindingProtection = buildDnsRebindingProtection(
      config.getOrThrow<string>('MCP_PUBLIC_URL'),
      config.getOrThrow<number>('MCP_PORT'),
    );
  }

  @Post()
  async handle(@Req() request: McpRequest, @Res() response: Response): Promise<void> {
    const context = this.getRequestContext(request);
    const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...this.rebindingProtection,
    });

    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.registry.listTools() }));
    server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
      this.registry.callTool(params.name, params.arguments, context),
    );
    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  /** Stateless mode has no server-initiated stream to open... */
  @Get()
  rejectGet(@Res() response: Response): void {
    rejectMethod(response);
  }

  /** ...and no session to end. */
  @Delete()
  rejectDelete(@Res() response: Response): void {
    rejectMethod(response);
  }

  /**
   * Authentication resolves the caller onto the request before this runs. Without it, only a
   * server started with `MCP_AUTH_ENABLED=false` may treat the caller as local; with it on, a
   * request nothing has identified is refused rather than served as `local`.
   */
  private getRequestContext(request: McpRequest): RequestContext {
    if (request.mcpContext) {
      return request.mcpContext;
    }
    if (this.config.getOrThrow<boolean>('MCP_AUTH_ENABLED')) {
      throw new UnauthorizedException();
    }

    return LOCAL_REQUEST_CONTEXT;
  }
}

function rejectMethod(response: Response): void {
  response
    .status(HttpStatus.METHOD_NOT_ALLOWED)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: { code: JSON_RPC_SERVER_ERROR, message: 'Method not allowed: use POST.' },
      id: null,
    });
}
