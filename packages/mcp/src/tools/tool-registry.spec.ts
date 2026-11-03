import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '@nestjs/core';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ToolCallAudit, ToolCallOutcome } from '../audit/tool-call-audit';
import { TOOL_CALLS_PER_MINUTE, ToolLimits } from '../limits/tool-limits';
import { RequestContext } from '../request-context/request-context';
import { ToolError } from './tool-error';
import { ToolKind, ToolRegistration } from './tool-registration';
import { ToolRegistry } from './tool-registry';

const CONTEXT: RequestContext = { identity: { kind: 'local' } };

function buildTool(
  overrides: Partial<ToolRegistration> & Pick<ToolRegistration, 'name' | 'kind'>,
): ToolRegistration {
  return {
    description: `The ${overrides.name} tool.`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    handler: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  const record = jest.fn();

  function buildRegistry(tools: ToolRegistration[], writeToolsEnabled: boolean): ToolRegistry {
    return new ToolRegistry(
      {
        getProviders: () => tools.map((instance) => ({ instance })),
      } as unknown as DiscoveryService,
      new ConfigService({ MCP_WRITE_TOOLS_ENABLED: writeToolsEnabled }),
      new ToolLimits(),
      { record } as unknown as ToolCallAudit,
    );
  }

  const readTool = buildTool({ name: 'list_things', kind: ToolKind.READ });
  const writeTool = buildTool({ name: 'change_thing', kind: ToolKind.WRITE });

  describe('listTools', () => {
    it('lists every tool and marks write tools destructive and not idempotent', () => {
      const tools = buildRegistry([readTool, writeTool], true).listTools();

      expect(tools).toEqual([
        {
          name: 'list_things',
          description: 'The list_things tool.',
          inputSchema: readTool.inputSchema,
        },
        {
          name: 'change_thing',
          description: 'The change_thing tool.',
          inputSchema: writeTool.inputSchema,
          annotations: { destructiveHint: true, idempotentHint: false },
        },
      ]);
    });

    it('leaves write tools out when MCP_WRITE_TOOLS_ENABLED is false', () => {
      const names = buildRegistry([readTool, writeTool], false)
        .listTools()
        .map((tool) => tool.name);

      expect(names).toEqual(['list_things']);
    });

    it('is empty when no area registers a tool', () => {
      expect(buildRegistry([], true).listTools()).toEqual([]);
    });

    it('refuses two tools under one name', () => {
      expect(() => buildRegistry([readTool, readTool], true).listTools()).toThrow(/list_things/);
    });
  });

  describe('callTool', () => {
    const closedTool = buildTool({
      name: 'closed_tool',
      kind: ToolKind.WRITE,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, confirmationToken: { type: 'string' } },
        additionalProperties: false,
      },
    });

    it('refuses an argument a closed schema does not list, without running the handler', async () => {
      const handler = jest.fn();
      const registry = buildRegistry([buildTool({ ...closedTool, handler })], true);

      const result = await registry.callTool('closed_tool', { id: 'a', idd: 'b' }, CONTEXT);

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Unknown argument idd. This tool accepts: id, confirmationToken.',
        },
      ]);
      expect(handler).not.toHaveBeenCalled();
    });

    it('accepts every listed argument, the confirmation token included', async () => {
      const handler = jest.fn().mockResolvedValue({ ok: true });
      const registry = buildRegistry([buildTool({ ...closedTool, handler })], true);

      const result = await registry.callTool(
        'closed_tool',
        { id: 'a', confirmationToken: 't' },
        CONTEXT,
      );

      expect(result.isError).toBeUndefined();
      expect(handler).toHaveBeenCalled();
    });

    it('leaves a tool whose schema is open alone', async () => {
      const registry = buildRegistry([readTool], true);

      const result = await registry.callTool('list_things', { anything: 1 }, CONTEXT);

      expect(result.isError).toBeUndefined();
    });

    it('returns the handler output as JSON text and audits a success', async () => {
      const handler = jest.fn().mockResolvedValue({ rows: [1, 2] });
      const registry = buildRegistry([buildTool({ ...readTool, handler })], true);

      const result = await registry.callTool('list_things', { id: 'x' }, CONTEXT);

      expect(result).toEqual({ content: [{ type: 'text', text: '{"rows":[1,2]}' }] });
      expect(handler).toHaveBeenCalledWith({ id: 'x' }, CONTEXT);
      expect(record).toHaveBeenCalledWith(
        CONTEXT,
        expect.objectContaining({
          tool: 'list_things',
          argumentKeys: ['id'],
          resultBytes: 14,
          outcome: ToolCallOutcome.SUCCESS,
        }),
      );
    });

    it('turns a ToolError into an error result the model can read', async () => {
      const handler = jest.fn().mockRejectedValue(new ToolError('Onboarding not found.'));
      const registry = buildRegistry([buildTool({ ...readTool, handler })], true);

      const result = await registry.callTool('list_things', {}, CONTEXT);

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Onboarding not found.' }],
        isError: true,
      });
      expect(record).toHaveBeenCalledWith(
        CONTEXT,
        expect.objectContaining({ outcome: ToolCallOutcome.ERROR }),
      );
    });

    it('hides the cause of an unexpected failure from the model', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('select * from secrets'));
      const registry = buildRegistry([buildTool({ ...readTool, handler })], true);
      jest.spyOn(registry['logger'], 'error').mockImplementation();

      const result = await registry.callTool('list_things', {}, CONTEXT);

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('secrets');
    });

    it('refuses calls beyond the per-minute ceiling without running the handler', async () => {
      const handler = jest.fn().mockResolvedValue({});
      const registry = buildRegistry([buildTool({ ...readTool, handler })], true);

      for (let call = 0; call < TOOL_CALLS_PER_MINUTE; call++) {
        await registry.callTool('list_things', {}, CONTEXT);
      }
      const result = await registry.callTool('list_things', {}, CONTEXT);

      expect(handler).toHaveBeenCalledTimes(TOOL_CALLS_PER_MINUTE);
      expect(result.isError).toBe(true);
      expect(record).toHaveBeenLastCalledWith(
        CONTEXT,
        expect.objectContaining({ outcome: ToolCallOutcome.RATE_LIMITED }),
      );
    });

    it('treats an unknown tool, and a write tool that is switched off, as unknown', async () => {
      const handler = jest.fn();
      const registry = buildRegistry([buildTool({ ...writeTool, handler })], false);

      await expect(registry.callTool('change_thing', {}, CONTEXT)).rejects.toBeInstanceOf(McpError);
      await expect(registry.callTool('nope', {}, CONTEXT)).rejects.toThrow(/Unknown tool: nope/);

      expect(handler).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledWith(
        CONTEXT,
        expect.objectContaining({ tool: 'change_thing', outcome: ToolCallOutcome.UNKNOWN_TOOL }),
      );
    });
  });
});
