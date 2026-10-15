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

  it('ships the Algoan credit check built-in with a users fork that differs only in id and name', () => {
    const find = (workflows: CheckedInWorkflow[], id: string) =>
      workflows.find((workflow) => workflow.normalized.id === id);
    const shipped = find(builtIn, 'uk-bnpl-credit-check-algoan');
    const fork = find(users, 'uk-bnpl-credit-check-algoan-local');

    expect(shipped).toBeDefined();
    expect(fork).toBeDefined();
    expect(everyConnector(shipped!.normalized).map(({ connector }) => connector.id)).toContain(
      'algoan_credit',
    );
    expect({ ...fork!.authored, id: undefined, name: undefined }).toEqual({
      ...shipped!.authored,
      id: undefined,
      name: undefined,
    });
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

  it('claims every source key for one family, whichever scope declares it', () => {
    // Revisions of a family share their source keys; a fork that keeps the original's key is
    // refused at boot with DuplicateWorkflowSourceKeyError, so it has to fail here first.
    const familiesBySourceKey = new Map<string, Set<string>>();

    for (const workflow of everything) {
      for (const { connector } of everyConnector(workflow.normalized)) {
        for (const declaration of [connector, ...connector.fallbacks]) {
          const key = declaration.config.sourceKey;

          if (typeof key === 'string') {
            familiesBySourceKey.set(
              key,
              new Set([...(familiesBySourceKey.get(key) ?? []), workflow.normalized.id]),
            );
          }
        }
      }
    }

    expect(familiesBySourceKey.size).toBeGreaterThan(1);
    expect(
      [...familiesBySourceKey]
        .filter(([, families]) => families.size > 1)
        .map(([key, families]) => [key, [...families]]),
    ).toEqual([]);
  });

  // The docs site keys a fixture's description and `/fixtures/<stem>` URL by file stem and titles
  // the page by id, so the two must agree.
  it.each(fixtures.map((workflow) => [workflow.file, workflow] as const))(
    '%s is named after its id',
    (file, workflow) => {
      expect(file).toBe(`${workflow.normalized.id}.workflow.json`);
    },
  );
});
