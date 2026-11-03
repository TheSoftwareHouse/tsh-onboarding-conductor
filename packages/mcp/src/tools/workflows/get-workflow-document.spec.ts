import { RequestContext } from '../../request-context/request-context';
import { GetWorkflowDocumentTool } from './get-workflow-document.tool';
import { StoredVersion, WorkflowVersionReader } from './workflow-version-reader';

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const REDACTED = '[redacted]';

const HTTP_CALL_STEP = {
  name: 'provision_account',
  type: 'http-call',
  config: {
    connector: { name: 'account_provisioning' },
    request: {
      method: 'POST',
      url: 'https://accounts.example.internal/v1/accounts',
      headers: {
        'X-Api-Key': 'sk_live_abc123',
        Authorization: 'Bearer {{secrets.accounts.token}}',
        'X-Tenant': '{{secrets.accounts.tenant}}',
        'Idempotency-Key': '{{execution.onboardingId}}',
        'X-Mixed': 'prefix-{{secrets.accounts.token}}',
        'X-Typo': 'Bearer abc {{secrets.accounts.token}}',
      },
    },
  },
};

const CONNECTOR_CALL_STEP = {
  name: 'screen',
  type: 'connector-call',
  config: {
    connectors: [
      {
        name: 'screening',
        id: 'http_request',
        type: 'custom',
        config: { request: { method: 'GET', headers: { Cookie: 'session=1' } } },
        fallback: [{ id: 'http_request', config: { request: { headers: { Token: 'abc' } } } }],
      },
      {
        name: 'mail',
        id: 'smtp_email_otp',
        config: { request: { headers: { Authorization: 'literal-but-another-connector' } } },
      },
    ],
  },
};

describe('GetWorkflowDocumentTool', () => {
  function buildTool(document: StoredVersion['document'], status: StoredVersion['status']) {
    const getStored = jest.fn().mockResolvedValue({
      workflowId: 'analyst-investigation',
      version: 1,
      status,
      document,
    });
    const tool = new GetWorkflowDocumentTool({ getStored } as unknown as WorkflowVersionReader);

    return { tool, getStored };
  }

  const read = (tool: GetWorkflowDocumentTool) =>
    tool.handler({ workflowId: 'analyst-investigation', version: 1 }, CONTEXT);

  it('returns a document without an http_request connector unchanged', async () => {
    const document = {
      id: 'analyst-investigation',
      version: 1,
      steps: [{ name: 'a', type: 'form' }],
    };
    const { tool, getStored } = buildTool(document, 'published');

    expect(await read(tool)).toEqual({
      workflowId: 'analyst-investigation',
      version: 1,
      status: 'published',
      document,
      redactions: [],
    });
    expect(getStored).toHaveBeenCalledWith(
      { workflowId: 'analyst-investigation', version: 1 },
      CONTEXT,
    );
  });

  it('blanks a literal header on an http-call step and reports its path', async () => {
    const { tool } = buildTool({ id: 'x', version: 1, steps: [HTTP_CALL_STEP] }, 'published');

    expect(await read(tool)).toMatchObject({
      document: {
        steps: [{ config: { request: { headers: { 'X-Api-Key': REDACTED } } } }],
      },
      redactions: expect.arrayContaining(['$.steps[0].config.request.headers.X-Api-Key']),
    });
  });

  it('keeps a header made only of placeholders, with or without an auth scheme word', async () => {
    const { tool } = buildTool({ id: 'x', version: 1, steps: [HTTP_CALL_STEP] }, 'published');

    expect(await read(tool)).toMatchObject({
      document: {
        steps: [
          {
            config: {
              request: {
                headers: {
                  'X-Api-Key': REDACTED,
                  Authorization: 'Bearer {{secrets.accounts.token}}',
                  'X-Tenant': '{{secrets.accounts.tenant}}',
                  'Idempotency-Key': '{{execution.onboardingId}}',
                  'X-Mixed': REDACTED,
                  'X-Typo': REDACTED,
                },
              },
            },
          },
        ],
      },
      redactions: [
        '$.steps[0].config.request.headers.X-Api-Key',
        '$.steps[0].config.request.headers.X-Mixed',
        '$.steps[0].config.request.headers.X-Typo',
      ],
    });
  });

  it('blanks a literal query value, keeps placeholders, and leaves url and body as authored', async () => {
    const step = {
      name: 'lookup',
      type: 'http-call',
      config: {
        request: {
          method: 'POST',
          url: 'https://lookup.example.internal/v1?inline=1',
          query: {
            api_key: 'sk_live_abc123',
            token: '{{secrets.lookup.token}}',
            applicant: '{{payload.email}}',
            mixed: 'pre-{{secrets.lookup.token}}',
            scheme: 'Bearer {{secrets.lookup.token}}',
            limit: 10,
          },
          body: { note: 'literal body value' },
        },
      },
    };
    const { tool } = buildTool({ id: 'x', version: 1, steps: [step] }, 'published');

    expect(await read(tool)).toMatchObject({
      document: {
        steps: [
          {
            config: {
              request: {
                url: 'https://lookup.example.internal/v1?inline=1',
                query: {
                  api_key: REDACTED,
                  token: '{{secrets.lookup.token}}',
                  applicant: '{{payload.email}}',
                  mixed: REDACTED,
                  scheme: REDACTED,
                  limit: REDACTED,
                },
                body: { note: 'literal body value' },
              },
            },
          },
        ],
      },
      redactions: [
        '$.steps[0].config.request.query.api_key',
        '$.steps[0].config.request.query.mixed',
        '$.steps[0].config.request.query.scheme',
        '$.steps[0].config.request.query.limit',
      ],
    });
  });

  it('redacts headers before query values in one request, and a connector declaration alike', async () => {
    const connector = {
      name: 'lookup',
      id: 'http_request',
      config: { request: { headers: { Cookie: 'a=1' }, query: { key: 'abc' } } },
    };
    const { tool } = buildTool(
      { id: 'x', version: 1, steps: [{ name: 's', config: { connectors: [connector] } }] },
      'draft',
    );

    expect(await read(tool)).toMatchObject({
      redactions: [
        '$.steps[0].config.connectors[0].config.request.headers.Cookie',
        '$.steps[0].config.connectors[0].config.request.query.key',
      ],
    });
  });

  it('finds http_request connectors and their fallbacks wherever a step nests them', async () => {
    const { tool } = buildTool({ id: 'x', version: 1, steps: [CONNECTOR_CALL_STEP] }, 'draft');

    expect(await read(tool)).toMatchObject({
      status: 'draft',
      redactions: [
        '$.steps[0].config.connectors[0].config.request.headers.Cookie',
        '$.steps[0].config.connectors[0].fallback[0].config.request.headers.Token',
      ],
    });
  });

  it('does not change the document the engine returned', async () => {
    const document = { id: 'x', version: 1, steps: [HTTP_CALL_STEP] };
    const before = structuredClone(document);
    const { tool } = buildTool(document, 'retired');

    expect(await read(tool)).toMatchObject({ status: 'retired' });
    expect(document).toEqual(before);
  });

  it('refuses a version that is not a whole number', async () => {
    const { tool } = buildTool({}, 'published');

    await expect(tool.handler({ workflowId: 'x', version: 1.5 }, CONTEXT)).rejects.toThrow(
      'version is required and must be a whole number of 1 or more.',
    );
  });
});
