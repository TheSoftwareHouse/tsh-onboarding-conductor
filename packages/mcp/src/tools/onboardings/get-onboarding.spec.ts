import { FieldClassLookup } from '../../classification/field-class-lookup';
import { ANALYST_INVESTIGATION_COMPILED } from '../../classification/testing/analyst-investigation.fixture';
import { EngineClient } from '../../engine/engine-client';
import { EngineError } from '../../engine/engine-error';
import { ToolLimits } from '../../limits/tool-limits';
import { buildCsvColumnClasses } from '../../masking/csv-columns';
import { FieldClassifier } from '../../masking/field-classifier';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { GetOnboardingTool } from './get-onboarding.tool';

const CONTEXT: RequestContext = { identity: { kind: 'local' } };
const ONBOARDING_ID = '01a19540-573f-71b6-bef5-a59df7152416';
const NOT_FOUND = 404;

const SUMMARY = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'analyst-investigation',
  workflowVersion: 1,
  status: 'rejected',
  currentStep: null,
  expiresAt: null,
  createdAt: '2026-10-11T03:56:24.255Z',
  updatedAt: '2026-10-11T03:56:24.507Z',
  completedAt: '2026-10-11T03:56:24.581Z',
  rejectionReason: null,
  scores: { risk: 70 },
  agreementStatus: 'not_accepted',
  pendingConnector: null,
};

const CSV =
  '﻿Onboarding id,Workflow id,Workflow version,Status,Current step,Agreement status,Rejection reason,Created at,Updated at,Completed at,Risk score,First name,Last name,Date of birth,Country,Occupation title,Source of funds,Pep self declared,Email,Mystery,Other data\r\n' +
  `${ONBOARDING_ID},analyst-investigation,1,rejected,,not_accepted,,2026-10-11T03:56:24.255Z,2026-10-11T03:56:24.507Z,2026-10-11T03:56:24.581Z,70,Drew,"Luettgen, Jr.",1985-06-25,TR,"Customer ""Markets"" Technician",sale_of_asset,true,drew.luettgen.9@example.com,surprise,{}\r\n`;

function bodyOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const middle = Math.floor(bytes.length / 2);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, middle));
      controller.enqueue(bytes.slice(middle));
      controller.close();
    },
  });
}

describe('GetOnboardingTool', () => {
  const classes = new FieldClassifier(['country', 'nationality']).classify(
    ANALYST_INVESTIGATION_COMPILED,
  );
  let request: jest.Mock;
  let openStream: jest.Mock;
  let limits: ToolLimits;
  let tool: GetOnboardingTool;

  type Result = {
    onboarding: { scores: object };
    agreements: object[];
    collectedData: Record<string, unknown> | null;
    withheldFields: string[];
    warnings?: string[];
  };

  beforeEach(() => {
    request = jest.fn((_method: string, path: string) =>
      Promise.resolve(
        path === '/v1/onboardings/{id}'
          ? SUMMARY
          : {
              onboardingId: ONBOARDING_ID,
              items: [
                {
                  key: 'terms',
                  type: 'terms_and_conditions',
                  latestAgreementId: 'x',
                  latestVersion: 2,
                  acceptedVersion: 1,
                  acceptedAt: '2026-10-11T03:56:25.000Z',
                  status: 'outdated',
                },
              ],
            },
      ),
    );
    openStream = jest.fn(() => Promise.resolve(bodyOf(CSV)));
    limits = new ToolLimits();
    const lookup = {
      getCsvColumnClasses: jest.fn((headers: string[]) =>
        Promise.resolve({ columns: buildCsvColumnClasses(headers, classes), failures: [] }),
      ),
    } as unknown as FieldClassLookup;
    tool = new GetOnboardingTool(
      { request, openStream } as unknown as EngineClient,
      lookup,
      new Masker('k'.repeat(32)),
      limits,
    );
  });

  it('returns summary, agreements and masked collected data from the export of this onboarding only', async () => {
    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as Result;

    expect(openStream).toHaveBeenCalledWith('/v1/onboardings/export', CONTEXT, {
      query: { onboardingId: ONBOARDING_ID },
    });
    expect(result.onboarding).toMatchObject({ status: 'rejected', scores: { risk: 70 } });
    expect(result.agreements).toEqual([
      {
        key: 'terms',
        type: 'terms_and_conditions',
        latestVersion: 2,
        acceptedVersion: 1,
        acceptedAt: '2026-10-11T03:56:25.000Z',
        status: 'outdated',
      },
    ]);
    expect(result.collectedData).toEqual({
      'Date of birth': '40-49',
      Country: 'TR',
      'Source of funds': 'sale_of_asset',
      'Pep self declared': 'true',
      Email: expect.stringMatching(/^email:[0-9a-f]{12}$/),
    });
    expect(result.withheldFields).toEqual([
      'First name',
      'Last name',
      'Occupation title',
      'Mystery',
      'Other data',
    ]);
  });

  it('never lets a name, address, free text or email through in clear', async () => {
    const result = await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT);
    const text = JSON.stringify(result);

    for (const secret of [
      'Drew',
      'Luettgen',
      'Markets',
      'Technician',
      'example.com',
      '1985',
      'surprise',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('releases the export slot after a success and after a failed export', async () => {
    await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT);
    openStream.mockRejectedValueOnce(new EngineError('The engine answered 500', 500));

    await expect(tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)).rejects.toThrow(
      EngineError,
    );
    await expect(tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)).resolves.toBeDefined();
  });

  it('refuses while another export of the same analyst is running', async () => {
    limits.acquireCsvExport(CONTEXT.identity);

    await expect(tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)).rejects.toThrow(
      'already running',
    );
    expect(openStream).not.toHaveBeenCalled();
  });

  it('says so when the export holds no row', async () => {
    openStream.mockResolvedValueOnce(bodyOf('﻿Onboarding id,Status\r\n'));

    const result = (await tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)) as Result;

    expect(result.collectedData).toBeNull();
    expect(result.warnings?.[0]).toContain('no row');
  });

  it('does not start an export for an onboarding the engine does not know', async () => {
    request.mockRejectedValueOnce(new EngineError('Not found (404).', NOT_FOUND));

    await expect(tool.handler({ onboardingId: ONBOARDING_ID }, CONTEXT)).rejects.toThrow(
      'Not found',
    );
    expect(openStream).not.toHaveBeenCalled();
  });
});
