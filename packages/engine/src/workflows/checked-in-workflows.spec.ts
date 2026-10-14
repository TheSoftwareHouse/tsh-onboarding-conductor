import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  RawWorkflowDefinition,
} from '@tsh/ddl-schema';
import { parseHttpConnectorConfig } from '../connectors/adapters/built-in/http-request/http-request-config';
import { parseKycConfig } from '../connectors/adapters/built-in/kyc/kyc-config';
import { parseSumsubConfig } from '../connectors/adapters/built-in/sumsub-kyc/sumsub-config';
import type { ConnectorAdapterSummary } from '../connectors/ports/connector-execution.port';
import {
  BUILT_IN_WORKFLOWS_DIR,
  DEFAULT_USER_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from './workflow-roots';
import { WorkflowRegistryService } from './workflow-registry.service';

const KYC_CALLBACK_FIELDS = ['kycOutcome', 'kycRetryStep', 'kycReasonCodes', 'kycCustomerMessage'];

/** What the two KYC adapters declare: Veriff does not count attempts, so the kernel does. */
const KYC_ADAPTERS: readonly ConnectorAdapterSummary[] = [
  {
    id: 'sumsub_kyc',
    type: 'kyc',
    supportsAsyncCallback: true,
    scope: 'built-in',
    callbackFields: KYC_CALLBACK_FIELDS,
  },
  {
    id: 'veriff_kyc',
    type: 'kyc',
    supportsAsyncCallback: true,
    scope: 'built-in',
    callbackFields: [...KYC_CALLBACK_FIELDS, 'kycAttemptCount'],
  },
];

type CheckedInWorkflow = {
  readonly file: string;
  readonly authored: RawWorkflowDefinition;
  readonly normalized: NormalizedWorkflowDefinition;
};

const readScope = (directory: string): CheckedInWorkflow[] =>
  readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const authored = JSON.parse(
        readFileSync(resolve(directory, fileName), 'utf8'),
      ) as RawWorkflowDefinition;

      return { file: fileName, authored, normalized: validateAndNormalizeWorkflow(authored) };
    });

const TYPED_SUFFIX = '-typed';
const CUSTOM_STEP_TYPE = 'custom';

/**
 * Every fixture that compiles to exactly the steps its `custom` twin does. The others differ on
 * purpose and say how: `conditional-fields-and-transitions` gains the stray-submit arm every
 * `manual-review` step emits, `twilio-verify` gains the re-send path, and `scoring`, `sumsub-kyc` and
 * `veriff-kyc` collect through specialized steps whose fields are shaped by the step rather than by
 * hand — and, for the first two, the specialized form also declares the `kycAttemptCount` callback
 * field that the hand-written form predates.
 */
const IDENTICAL_PAIRS = [
  'base',
  'connector-fallback',
  'file-upload',
  'http-request',
  'lean-ksa',
  'manual-review',
  'manual-smtp',
  'sendgrid-email',
];

const stripIdentity = (definition: NormalizedWorkflowDefinition) => ({
  ...definition,
  id: undefined,
  name: undefined,
});

const everyConnector = (
  definition: NormalizedWorkflowDefinition,
): { stepName: string; connector: NormalizedWorkflowConnectorDeclaration }[] =>
  definition.steps.flatMap((step) =>
    step.connectors.map((connector) => ({ stepName: step.name, connector })),
  );

/**
 * What startup does to every checked-in file, without a database: load it, and run the adapters'
 * own declaration checks over it. A fixture that only loads is not enough — the Sumsub adapter's
 * `validateDeclaration` refuses a document whose `documents[]` name a payload key nothing maps,
 * and that has to fail here rather than on someone's boot.
 */
describe('checked-in workflows', () => {
  const builtIn = readScope(BUILT_IN_WORKFLOWS_DIR);
  const fixtures = readScope(FIXTURE_WORKFLOWS_DIR);
  const users = readScope(DEFAULT_USER_WORKFLOWS_DIR);
  const everything = [...builtIn, ...fixtures, ...users];

  it('are all typed steps, since nothing else is accepted', () => {
    for (const workflow of everything) {
      expect(Array.isArray(workflow.authored.steps)).toBe(true);
      expect(workflow.authored.steps.every((step) => typeof step.type === 'string')).toBe(true);
    }
  });

  it('declare every callback field their async KYC adapter emits, so either provider can be selected', () => {
    const registry = new WorkflowRegistryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { execute: jest.fn(), resume: jest.fn(), listAdapters: () => KYC_ADAPTERS },
    );

    for (const workflow of everything) {
      expect(() => registry.normalizeDefinition(workflow.authored as never)).not.toThrow();
    }
  });

  it('ships every Veriff declaration with the keys Sumsub needs, so the family can be switched back', () => {
    // The keys are inert for Veriff, which ignores `providerConfig`; dropping them would make the
    // selection rules refuse `sumsub_kyc` on the shipped family as `declaration_invalid`.
    const veriffDeclarations = [...builtIn, ...users].flatMap((workflow) =>
      everyConnector(workflow.normalized)
        .map(({ connector }) => connector)
        .filter((connector) => connector.id === 'veriff_kyc'),
    );

    expect(veriffDeclarations.length).toBeGreaterThan(0);
    for (const declaration of veriffDeclarations) {
      expect(() => parseSumsubConfig(declaration.config)).not.toThrow();
    }
  });

  it('declares every id in exactly one scope directory', () => {
    const scopesById = new Map<string, Set<string>>();

    for (const [scope, workflows] of [
      ['built-in', builtIn],
      ['fixtures', fixtures],
      ['users', users],
    ] as const) {
      for (const workflow of workflows) {
        scopesById.set(
          workflow.normalized.id,
          new Set([...(scopesById.get(workflow.normalized.id) ?? []), scope]),
        );
      }
    }

    // A family belongs to one scope: a shipped flow is forked under its own id, never revised
    // from another directory, and the loader refuses a boot where two directories declare one id.
    expect(
      [...scopesById]
        .filter(([, scopes]) => scopes.size > 1)
        .map(([id, scopes]) => [id, [...scopes]]),
    ).toEqual([]);
  });

  it.each(everything.map((workflow) => [workflow.file, workflow] as const))(
    '%s parses every connector config an adapter validates at load',
    (_file, workflow) => {
      for (const { stepName, connector } of everyConnector(workflow.normalized)) {
        for (const declaration of [connector, ...connector.fallbacks]) {
          if (declaration.id === 'sumsub_kyc' || declaration.id === 'veriff_kyc') {
            const config =
              declaration.id === 'sumsub_kyc'
                ? parseSumsubConfig(declaration.config)
                : parseKycConfig(declaration.id, declaration.config);
            const mapped = { ...declaration.fieldMapping, ...declaration.optionalFieldMapping };

            for (const document of config.documents) {
              expect(Object.keys(mapped)).toContain(document.payloadField);
              if (document.countryField !== undefined) {
                expect(Object.keys(mapped)).toContain(document.countryField);
              }
            }
          }

          if (declaration.id === 'http_request') {
            expect(() =>
              parseHttpConnectorConfig(
                {
                  context: `${workflow.normalized.id}/${stepName}`,
                  config: declaration.config,
                  fieldMapping: declaration.fieldMapping,
                },
                {},
              ),
            ).not.toThrow();
          }
        }
      }
    },
  );

  describe('fixtures', () => {
    const byId = new Map(fixtures.map((workflow) => [workflow.normalized.id, workflow]));
    const customIds = fixtures
      .map((workflow) => workflow.normalized.id)
      .filter((id) => !id.endsWith(TYPED_SUFFIX));

    it('ship every example twice: written as custom steps, and as specialized steps', () => {
      expect(customIds.length).toBeGreaterThan(0);

      for (const id of customIds) {
        const custom = byId.get(id)!;
        const typed = byId.get(`${id}${TYPED_SUFFIX}`);

        expect(typed).toBeDefined();
        expect(custom.file).toBe(`${id}.workflow.json`);
        expect(typed!.file).toBe(`${id}${TYPED_SUFFIX}.workflow.json`);
        expect(custom.authored.steps.every((step) => step.type === CUSTOM_STEP_TYPE)).toBe(true);
        expect(typed!.authored.steps.some((step) => step.type === CUSTOM_STEP_TYPE)).toBe(false);
      }
    });

    it.each(IDENTICAL_PAIRS)('%s compiles to the same steps in both forms', (id) => {
      expect(stripIdentity(byId.get(`${id}${TYPED_SUFFIX}`)!.normalized)).toEqual(
        stripIdentity(byId.get(id)!.normalized),
      );
    });

    it.each([
      ['scoring', false],
      ['sumsub-kyc', false],
      ['veriff-kyc', true],
    ])(
      '%s declares the kycAttemptCount callback field in the custom form: %s',
      (id, declaredByCustom) => {
        const callbackFields = (workflowId: string): string[] =>
          Object.keys(byId.get(workflowId)!.normalized.stepsByName.submit_kyc.data);

        // The custom Sumsub files predate the field; the specialized step type always emits it.
        expect(callbackFields(id).includes('kycAttemptCount')).toBe(declaredByCustom);
        expect(callbackFields(`${id}${TYPED_SUFFIX}`)).toContain('kycAttemptCount');
      },
    );

    it('lets a manual review declare no invalid outcome, exactly as its custom twin does', () => {
      const custom = byId.get('conditional-fields-and-transitions')!.normalized;
      const typed = byId.get('conditional-fields-and-transitions-typed')!.normalized;

      for (const name of ['review_us', 'review_default']) {
        // The one difference: a manual-review step always keeps a stray submit where it was.
        expect(typed.stepsByName[name].transitions).toEqual([
          expect.objectContaining({ status: 'success' }),
          ...custom.stepsByName[name].transitions,
        ]);
      }
      expect(typed.stepsByName.collect_details).toEqual(custom.stepsByName.collect_details);
    });

    it('proves the phone number through an OTP step that adds only the re-send path', () => {
      const custom = byId.get('twilio-verify')!.normalized;
      const typed = byId.get('twilio-verify-typed')!.normalized;

      expect(typed.steps.map((step) => step.name)).toEqual([
        'request_code',
        'verify_code',
        'request_code_resend',
        'approved',
        'rejected',
      ]);
      expect(typed.stepsByName.request_code.data).toEqual(custom.stepsByName.request_code.data);
      expect(typed.stepsByName.request_code.connectors).toEqual(
        custom.stepsByName.request_code.connectors,
      );
    });

    it('scores from the steps that collect, prove and verify, on the step where each outcome is known', () => {
      const typed = byId.get('scoring-typed')!.normalized;

      expect(typed.stepsByName.collect_profile.scoring).toHaveLength(6);
      expect(typed.stepsByName.request_code.scoring).toEqual([]);
      expect(typed.stepsByName.verify_code.scoring).toEqual([
        { score: 'trust', when: { field: 'pepSelfDeclared', equals: false }, add: 15 },
      ]);
      expect(typed.stepsByName.submit_kyc.scoring).toHaveLength(3);
      // The verified verdict still lands on review when the risk accumulated so far says so.
      expect(typed.stepsByName.submit_kyc.transitions[0]).toMatchObject({
        when: {
          all: [
            { field: 'kycOutcome', equals: 'verified' },
            { score: 'risk', gte: 60 },
          ],
        },
        target: 'manual_review',
      });
      expect(typed.stepsByName.manual_review.transitions).toEqual([
        expect.objectContaining({ status: 'success' }),
        expect.objectContaining({ status: 'manual.approve', target: 'approved' }),
        expect.objectContaining({ status: 'manual.reject', target: 'rejected' }),
        expect.objectContaining({
          status: 'manual.invalid',
          when: { score: 'risk', lte: 45 },
          target: 'request_code',
        }),
        expect.objectContaining({ status: 'manual.invalid', target: 'rejected' }),
      ]);
    });

    it('claims a source key of its own for every typed twin, whichever provider it binds', () => {
      const sourceKeys = fixtures.flatMap((workflow) =>
        everyConnector(workflow.normalized)
          .map(({ connector }) => connector.config.sourceKey)
          .filter((key): key is string => typeof key === 'string')
          .map((key) => [key, workflow.normalized.id] as const),
      );
      const workflowIdBySourceKey = new Map<string, string>();

      for (const [key, id] of sourceKeys) {
        expect(workflowIdBySourceKey.get(key) ?? id).toBe(id);
        workflowIdBySourceKey.set(key, id);
      }
    });
  });
});
