import { describe, expect, it } from 'vitest';
import { MAX_DRAFT_VERSION, MAX_WORKFLOW_ID_LENGTH } from '../constants/new-draft';
import { newDraftSchema, parseDraftUpload, type NewDraftValues } from './new-draft-schema';

const EMPTY: NewDraftValues = {
  source: 'empty',
  workflowId: 'my-flow',
  version: '1',
  name: '',
  upload: null,
  fork: null,
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
      name: '',
    });
  });

  it('returns the file name, or an empty string when it has none or a non-string one', () => {
    expect(parseDraftUpload('{"id":"f","version":1,"name":"Flow"}')).toMatchObject({
      name: 'Flow',
    });
    expect(parseDraftUpload('{"id":"f","version":1,"name":7}')).toMatchObject({ name: '' });
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

  it('posts a ready upload under the typed id, version and name', () => {
    const document = { id: 'flow', version: 3, name: 'Flow', steps: [] };

    expect(
      newDraftSchema.parse({
        ...EMPTY,
        source: 'upload',
        workflowId: ' renamed ',
        version: '4',
        name: ' Renamed ',
        upload: { status: 'ready', document, id: 'flow', version: 3, name: 'Flow' },
      }),
    ).toEqual({ id: 'renamed', version: 4, name: 'Renamed', steps: [] });
  });

  it('removes the name of an upload when the Name field is empty', () => {
    const document = { id: 'flow', version: 3, name: 'Flow', steps: [] };

    expect(
      newDraftSchema.parse({
        ...EMPTY,
        source: 'upload',
        upload: { status: 'ready', document, id: 'flow', version: 3, name: 'Flow' },
      }),
    ).toEqual({ id: 'my-flow', version: 1, steps: [] });
  });

  it('checks the typed id and version of an upload', () => {
    expect(
      messagesOf({
        ...EMPTY,
        source: 'upload',
        workflowId: '',
        version: '0',
        upload: {
          status: 'ready',
          document: { id: 'flow', version: 3 },
          id: 'flow',
          version: 3,
          name: '',
        },
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

describe('newDraftSchema fork arm', () => {
  const FORK: NewDraftValues = {
    ...EMPTY,
    source: 'fork',
    workflowId: 'copy',
    version: '2',
    name: ' Copy ',
    fork: {
      workflowId: 'kyc',
      scope: 'users',
      document: { id: 'kyc', version: 1, name: 'KYC', steps: [{ id: 'a' }] },
    },
  };

  it('overrides the source id, version and name and keeps the rest', () => {
    expect(newDraftSchema.parse(FORK)).toEqual({
      id: 'copy',
      version: 2,
      name: 'Copy',
      steps: [{ id: 'a' }],
    });
  });

  it('removes the source name when the Name field is empty', () => {
    expect(newDraftSchema.parse({ ...FORK, name: '' })).toEqual({
      id: 'copy',
      version: 2,
      steps: [{ id: 'a' }],
    });
  });

  it('renames every connector source key from the new id, keeping shared keys shared', () => {
    const document = {
      id: 'kyc',
      version: 1,
      steps: [
        { name: 'a', type: 'kyc-identity-verification', config: { sourceKey: 'kyc_v1' } },
        { name: 'b', type: 'kyc-identity-verification', config: { sourceKey: 'kyc_v1' } },
        { name: 'c', type: 'custom', config: { connectors: [{ config: { sourceKey: 'other' } }] } },
      ],
    };

    expect(
      newDraftSchema.parse({
        ...FORK,
        workflowId: 'my-kyc',
        fork: { workflowId: 'kyc', scope: 'users', document },
      }),
    ).toMatchObject({
      steps: [
        { config: { sourceKey: 'my_kyc' } },
        { config: { sourceKey: 'my_kyc' } },
        { config: { connectors: [{ config: { sourceKey: 'my_kyc_2' } }] } },
      ],
    });
  });

  it('keeps the source keys when the id is unchanged', () => {
    const document = { id: 'kyc', version: 1, steps: [{ config: { sourceKey: 'kyc_v1' } }] };

    expect(
      newDraftSchema.parse({
        ...FORK,
        workflowId: 'kyc',
        fork: { workflowId: 'kyc', scope: 'users', document },
      }),
    ).toMatchObject({ steps: [{ config: { sourceKey: 'kyc_v1' } }] });
  });

  it('fails without a source', () => {
    expect(messagesOf({ ...FORK, fork: null })).toEqual(['Choose a workflow and a version.']);
  });

  it('checks the typed id and version', () => {
    expect(messagesOf({ ...FORK, workflowId: '', version: '0' })).toEqual([
      'A workflow id is required.',
      'The version is a whole number from 1 to 2147483647.',
    ]);
  });
});
