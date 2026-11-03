import { ToolError } from '../tools/tool-error';

/** The engine refused a call, or could not be reached. `status` is absent when it did not answer. */
export class EngineError extends ToolError {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}
