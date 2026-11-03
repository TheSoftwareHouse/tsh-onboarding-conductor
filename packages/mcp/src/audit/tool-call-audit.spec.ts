import { ConfigService } from '@nestjs/config';
import { DiscoveryService } from '@nestjs/core';
import { ToolLimits } from '../limits/tool-limits';
import { RequestContext } from '../request-context/request-context';
import { ToolKind, ToolRegistration } from '../tools/tool-registration';
import { ToolRegistry } from '../tools/tool-registry';
import { ToolCallAudit, ToolCallOutcome } from './tool-call-audit';

describe('ToolCallAudit', () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  it('writes one JSON line naming the caller, tool, argument keys, size, duration and outcome', () => {
    const context: RequestContext = {
      identity: { kind: 'user', objectId: 'oid-1', upn: 'analyst@example.com' },
      engineToken: 'secret-engine-token',
    };

    new ToolCallAudit().record(context, {
      tool: 'find_onboardings',
      argumentKeys: ['status', 'limit'],
      resultBytes: 512,
      durationMs: 42,
      outcome: ToolCallOutcome.SUCCESS,
    });

    expect(written).toHaveLength(1);
    expect(written[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(written[0])).toEqual({
      event: 'tool_call',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      user: 'oid-1',
      tool: 'find_onboardings',
      argumentKeys: ['status', 'limit'],
      resultBytes: 512,
      durationMs: 42,
      outcome: 'success',
    });
  });

  it('names the caller local when nobody is signed in', () => {
    new ToolCallAudit().record(
      { identity: { kind: 'local' } },
      {
        tool: 'list_workflows',
        argumentKeys: [],
        resultBytes: 0,
        durationMs: 1,
        outcome: ToolCallOutcome.ERROR,
      },
    );

    expect(JSON.parse(written[0])).toMatchObject({ user: 'local', outcome: 'error' });
  });

  it('never writes an argument value, the token or the user principal name for a real tool call', async () => {
    const tool: ToolRegistration = {
      kind: ToolKind.READ,
      name: 'find_onboardings',
      description: 'Finds onboardings.',
      inputSchema: { type: 'object' },
      handler: () => Promise.resolve({ rows: [] }),
    };
    const registry = new ToolRegistry(
      { getProviders: () => [{ instance: tool }] } as unknown as DiscoveryService,
      new ConfigService({ MCP_WRITE_TOOLS_ENABLED: false }),
      new ToolLimits(),
      new ToolCallAudit(),
    );
    const context: RequestContext = {
      identity: { kind: 'user', objectId: 'oid-1', upn: 'analyst@example.com' },
      engineToken: 'secret-engine-token',
    };

    await registry.callTool(
      'find_onboardings',
      { email: 'applicant@example.com', onboardingId: 'onb-secret-123' },
      context,
    );

    const line = written.join('');
    expect(JSON.parse(line).argumentKeys).toEqual(['email', 'onboardingId']);
    expect(line).not.toContain('applicant@example.com');
    expect(line).not.toContain('onb-secret-123');
    expect(line).not.toContain('secret-engine-token');
    expect(line).not.toContain('analyst@example.com');
  });
});
