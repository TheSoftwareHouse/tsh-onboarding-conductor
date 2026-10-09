import { describe, expect, it } from 'vitest';
import { parseWorkflowDocument } from './parse-workflow-document';

describe('parseWorkflowDocument', () => {
  it('returns a JSON object as the document', () => {
    expect(parseWorkflowDocument('{"id":"kyc","version":1}')).toEqual({
      ok: true,
      document: { id: 'kyc', version: 1 },
    });
  });

  it('reports a syntax error with the parser message', () => {
    const result = parseWorkflowDocument('{"id":');

    expect(result.ok).toBe(false);
  });

  it.each(['[]', '3', 'null', '"text"'])('rejects %s as not an object', (text) => {
    expect(parseWorkflowDocument(text)).toEqual({
      ok: false,
      message: 'The document must be a JSON object.',
    });
  });
});
