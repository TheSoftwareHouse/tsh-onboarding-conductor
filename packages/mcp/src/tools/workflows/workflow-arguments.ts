import { ToolError } from '../tool-error';
import type { ToolArguments } from '../tool-registration';

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getDocument(args: ToolArguments): JsonObject {
  const value = args.document;

  if (!isJsonObject(value)) {
    throw new ToolError(
      'document is required and must be a workflow document object (id, version, steps), ' +
        'not a string.',
    );
  }

  return value;
}
