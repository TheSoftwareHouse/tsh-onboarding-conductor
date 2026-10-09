import { describe, expect, it } from 'vitest';
import { MAX_DRAFT_VERSION, MAX_WORKFLOW_ID_LENGTH } from '../constants/new-draft';
import { newDraftSchema, parseDraftUpload, type NewDraftValues } from './new-draft-schema';

const EMPTY: NewDraftValues = {
  source: 'empty',
  workflowId: 'my-flow',
  version: '1',
  name: '',
  upload: null,
};

function messagesOf(values: NewDraftValues): string[] {
  const result = newDraftSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('parseDraftUpload', () => {
  it('keeps the whole document and reads its id and version', () => {
    const document = { id: 'flow', version: 3, steps: [{ id: 'a' }] };

    expect(parseDraftUpload(JSON.stringify(document))).toEqual({
      status: 'ready',
      document,
      id: 'flow',
      version: 3,
    });
  });

  it.each([
    ['text that is not JSON', '{', 'The file is not valid JSON.'],
    ['an array', '[]', 'The file must contain a JSON object.'],
    ['null', 'null', 'The file must contain a JSON object.'],
    ['a missing id', '{"version":1}', 'A workflow id is required.'],
    ['an empty id', '{"id":"","version":1}', 'A workflow id is required.'],
    ['a numeric id', '{"id":7,"version":1}', 'A workflow id is required.'],
    [
      'an over-long id',
      JSON.stringify({ id: 'x'.repeat(MAX_WORKFLOW_ID_LENGTH + 1), version: 1 }),
      'The workflow id is at most 100 characters.',
    ],
    ['a missing version', '{"id":"flow"}', 'The version is a whole number from 1 to 2147483647.'],
    [
      'a string version',
      '{"id":"flow","version":"1"}',
      'The version is a whole number from 1 to 2147483647.',
    ],
    [
      'a fractional version',
      '{"id":"flow","version":1.5}',
      'The version is a whole number from 1 to 2147483647.',
    ],
    [
      'a version past the integer range',
      JSON.stringify({ id: 'flow', version: MAX_DRAFT_VERSION + 1 }),
      'The version is a whole number from 1 to 2147483647.',
    ],
  ])('refuses %s', (_case, text, message) => {
    expect(parseDraftUpload(text)).toEqual({ status: 'invalid', message });
  });
});

describe('newDraftSchema', () => {
  it('turns the Empty fields into the template document, trimmed', () => {
    expect(
      newDraftSchema.parse({
        ...EMPTY,
        workflowId: ' my-flow ',
        version: ' 2 ',
        name: ' My flow ',
      }),
    ).toEqual({ id: 'my-flow', version: 2, name: 'My flow', steps: [] });
  });

  it('leaves a blank name out of the template', () => {
    expect(newDraftSchema.parse({ ...EMPTY, name: '   ' })).toEqual({
      id: 'my-flow',
      version: 1,
      steps: [],
    });
  });

  it.each([
    ['a blank id', { workflowId: '  ' }, 'A workflow id is required.'],
    [
      'an over-long id',
      { workflowId: 'x'.repeat(MAX_WORKFLOW_ID_LENGTH + 1) },
      'The workflow id is at most 100 characters.',
    ],
    ['version 0', { version: '0' }, 'The version is a whole number from 1 to 2147483647.'],
    [
      'a fractional version',
      { version: '1.5' },
      'The version is a whole number from 1 to 2147483647.',
    ],
    [
      'an exponent version',
      { version: '1e2' },
      'The version is a whole number from 1 to 2147483647.',
    ],
    [
      'a version past the integer range',
      { version: String(MAX_DRAFT_VERSION + 1) },
      'The version is a whole number from 1 to 2147483647.',
    ],
  ])('refuses %s', (_case, change, message) => {
    expect(messagesOf({ ...EMPTY, ...change })).toEqual([message]);
  });

  it('posts a ready upload under the typed id and version, ignoring the Name field', () => {
    const document = { id: 'flow', version: 3, name: 'Flow', steps: [] };

    expect(
      newDraftSchema.parse({
        ...EMPTY,
        source: 'upload',
        workflowId: ' renamed ',
        version: '4',
        name: 'Ignored',
        upload: { status: 'ready', document, id: 'flow', version: 3 },
      }),
    ).toEqual({ id: 'renamed', version: 4, name: 'Flow', steps: [] });
  });

  it('checks the typed id and version of an upload', () => {
    expect(
      messagesOf({
        ...EMPTY,
        source: 'upload',
        workflowId: '',
        version: '0',
        upload: { status: 'ready', document: { id: 'flow', version: 3 }, id: 'flow', version: 3 },
      }),
    ).toEqual([
      'A workflow id is required.',
      'The version is a whole number from 1 to 2147483647.',
    ]);
  });

  it('asks for a file when none was chosen', () => {
    expect(messagesOf({ ...EMPTY, source: 'upload' })).toEqual(['Choose a .json file.']);
  });

  it("reports an unreadable upload's own message", () => {
    expect(
      messagesOf({
        ...EMPTY,
        source: 'upload',
        upload: { status: 'invalid', message: 'The file is not valid JSON.' },
      }),
    ).toEqual(['The file is not valid JSON.']);
  });
});
