import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  RawWorkflowDefinition,
} from '@tsh/ddl-schema';
import { parseHttpConnectorConfig } from '../connectors/adapters/built-in/http-request/http-request-config';
import { parseSumsubConfig } from '../connectors/adapters/built-in/sumsub-kyc/sumsub-config';
import {
  BUILT_IN_WORKFLOWS_DIR,
  DEFAULT_USER_WORKFLOWS_DIR,
  FIXTURE_WORKFLOWS_DIR,
} from './workflow-roots';

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
 * `manual-review` step emits, `twilio-verify` gains the re-send path, and `scoring` and `sumsub-kyc`
 * collect through specialized steps whose fields are shaped by the step rather than by hand.
 */
const IDENTICAL_PAIRS = [
  'base',
  'connector-fallback',
  'file-upload',
  'http-request',
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
          if (declaration.id === 'sumsub_kyc') {
            const config = parseSumsubConfig(declaration.config);
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

    it('claims a source key of its own for every typed Sumsub twin', () => {
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
