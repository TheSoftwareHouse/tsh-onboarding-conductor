import { Injectable } from '@nestjs/common';
import { getIdentityId, RequestContext } from '../request-context/request-context';

export enum ToolCallOutcome {
  SUCCESS = 'success',
  ERROR = 'error',
  RATE_LIMITED = 'rate_limited',
  UNKNOWN_TOOL = 'unknown_tool',
}

export interface ToolCallRecord {
  tool: string;
  argumentKeys: string[];
  resultBytes: number;
  durationMs: number;
  outcome: ToolCallOutcome;
}

/**
 * One JSON line on stdout per tool call. The line names the caller, the tool and the argument
 * keys, never an argument value or a token: the analyst's questions are not for a log.
 */
@Injectable()
export class ToolCallAudit {
  record(context: RequestContext, call: ToolCallRecord): void {
    const line = {
      event: 'tool_call',
      at: new Date().toISOString(),
      user: getIdentityId(context.identity),
      tool: call.tool,
      argumentKeys: call.argumentKeys,
      resultBytes: call.resultBytes,
      durationMs: call.durationMs,
      outcome: call.outcome,
    };

    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
}
