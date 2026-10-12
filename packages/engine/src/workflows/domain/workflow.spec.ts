import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileWorkflowReport,
  DEFAULT_CONNECTOR_RETRY,
  validateAndNormalizeWorkflow,
} from '@tsh/ddl-schema';
import { ConnectorPayloadFieldNotFoundError } from '../../connectors/errors/connector-payload-field-not-found.error';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../connectors/ports/connector-execution-result';
import type {
  ConnectorAdapterSummary,
  ConnectorExecutionPort,
} from '../../connectors/ports/connector-execution.port';
import { ConnectorSelectionRules, type WorkflowConnectorSelection } from './connector-selection';
import { normalizeUntypedSteps } from '../testing/untyped-steps.helper';
import { Workflow, type WorkflowEvaluationInput } from './workflow';

const baseWorkflowConfigPath = resolve(
  __dirname,
  '../../../../../workflows/fixtures/base.workflow.json',
);
const baseWorkflowConfig = JSON.parse(readFileSync(baseWorkflowConfigPath, 'utf8'));

/** What normalization fills in on a declaration that names neither a retry nor a fallback. */
const connectorDefaults = { retry: DEFAULT_CONNECTOR_RETRY, fallbacks: [] };

describe('Workflow', () => {
  const definition = normalizeUntypedSteps(baseWorkflowConfig);

  describe('describeDefinition', () => {
    it('projects every declared step and the transitions between them', () => {
      const described = new Workflow(definition).describeDefinition();

      expect(described.workflowId).toBe(definition.id);
      expect(described.workflowVersion).toBe(definition.version);
      expect(described.initialStep).toBe(definition.initial);
      expect(described.scores).toBe(definition.scores);
      expect(described.steps.map((step) => step.name)).toEqual(
        definition.steps.map((step) => step.name),
      );
      expect(described.steps.map((step) => step.terminal)).toEqual(
        definition.steps.map((step) => step.terminal),
      );
      expect(described.steps.flatMap((step) => step.transitions.map((t) => t.status))).toEqual(
        definition.steps.flatMap((step) => step.transitions.map((t) => t.status)),
      );
    });

    it('reports the label it was given, and null when it was given none', () => {
      expect(new Workflow(definition).describeDefinition().name).toBeNull();
      expect(new Workflow(definition, undefined, 'Base').describeDefinition().name).toBe('Base');
    });

    it('states an absent target and an absent guard rather than leaving them out', () => {
      const [firstStep] = new Workflow(definition).describeDefinition().steps;

      for (const transition of firstStep.transitions) {
        expect(transition).toHaveProperty('target');
        expect(transition).toHaveProperty('when');
      }
    });

    it('carries the step shape, its fields and its connectors, and nothing about how it runs', () => {
      const [firstStep] = new Workflow(definition).describeDefinition().steps;

      expect(Object.keys(firstStep).sort()).toEqual([
        'connectors',
        'fields',
        'name',
        'source',
        'status',
        'terminal',
        'transitions',
      ]);
    });

    it('states the root notify webhook, and null when none is declared', () => {
      expect(new Workflow(definition).describeDefinition().webhook).toEqual({
        notify: { path: 'notify' },
      });

      const withoutWebhook = { ...baseWorkflowConfig };
      delete withoutWebhook.webhook;

      expect(
        new Workflow(normalizeUntypedSteps(withoutWebhook)).describeDefinition().webhook,
      ).toBeNull();
    });

    it('projects a connector and its fallback without config, retry or errorHandler', () => {
      const withFallback = normalizeUntypedSteps({
        id: 'with-fallback',
        version: 1,
        initial: 'collect',
        steps: [
          {
            name: 'collect',
            status: 'awaiting_user',
            data: { email: { type: 'text', required: true } },
            connectors: [
              {
                name: 'primary',
                id: 'mock_kyc_1',
                type: 'kyc',
                order: 1,
                fieldMapping: { email: 'email' },
                config: { headers: { authorization: 'Bearer literal' } },
                errorHandler: 'retry_then_fallback',
                fallback: [
                  {
                    name: 'backup',
                    id: 'mock_kyc_2',
                    type: 'kyc',
                    fieldMapping: { email: 'email' },
                    config: { secret: 'literal' },
                  },
                ],
              },
            ],
            transitions: [{ status: 'success', target: 'done' }],
          },
          { name: 'done', status: 'approved', data: {}, transitions: [] },
        ],
      });

      const [collect] = new Workflow(withFallback).describeDefinition().steps;

      expect(collect.connectors).toEqual([
        {
          id: 'mock_kyc_1',
          name: 'primary',
          type: 'kyc',
          order: 1,
          canReject: expect.any(Boolean),
          async: false,
          fieldMapping: { email: 'email' },
          optionalFieldMapping: {},
          authoredId: 'mock_kyc_1',
          selected: false,
          selectableIds: ['mock_kyc_1'],
          fallbacks: [
            {
              id: 'mock_kyc_2',
              name: 'backup',
              type: 'kyc',
              order: 1,
              canReject: expect.any(Boolean),
              async: false,
              fieldMapping: { email: 'email' },
              optionalFieldMapping: {},
            },
          ],
        },
      ]);
      expect(JSON.stringify(collect.connectors)).not.toMatch(/config|retry|errorHandler|literal/);
    });

    describe('connector selections', () => {
      const SELECTABLE_STEPS = [
        {
          name: 'collect',
          status: 'awaiting_user',
          data: { email: { type: 'text', required: true } },
          connectors: [
            {
              name: 'primary',
              id: 'mock_kyc_1',
              type: 'kyc',
              order: 1,
              async: true,
              fieldMapping: { email: 'email' },
              config: { marker: 'authored' },
            },
          ],
          transitions: [{ status: 'success', target: 'done' }],
        },
        { name: 'done', status: 'approved', data: {}, transitions: [] },
      ];
      const selectable = normalizeUntypedSteps({
        id: 'selectable',
        version: 1,
        initial: 'collect',
        steps: SELECTABLE_STEPS,
      });
      const summary = (
        id: string,
        overrides: Partial<ConnectorAdapterSummary> = {},
      ): ConnectorAdapterSummary => ({
        id,
        type: 'kyc',
        supportsAsyncCallback: true,
        scope: 'built-in',
        callbackFields: [],
        ...overrides,
      });
      /** Rules over the given adapters, every scope active, no declaration checks. */
      const rules = (adapters: readonly ConnectorAdapterSummary[]): ConnectorSelectionRules =>
        new ConnectorSelectionRules(
          { execute: jest.fn(), resume: jest.fn(), listAdapters: () => adapters },
          ['built-in', 'fixtures', 'users'],
        );
      const describePrimary = (
        selections: WorkflowConnectorSelection[],
        adapters: ConnectorAdapterSummary[],
      ) =>
        new Workflow(selectable, undefined, null, selections).describeDefinition(
          undefined,
          rules(adapters),
        ).steps[0].connectors[0];

      it('projects the effective id, the authored id and that a selection is in force', () => {
        const primary = describePrimary([{ stepName: 'collect', connectorId: 'veriff_kyc' }], []);

        expect(primary).toEqual(
          expect.objectContaining({
            id: 'veriff_kyc',
            authoredId: 'mock_kyc_1',
            selected: true,
            selectableIds: ['mock_kyc_1', 'veriff_kyc'],
          }),
        );
      });

      it('lists the adapters the rules accept, sorted and unique, callback-capable for an async slot', () => {
        const primary = describePrimary(
          [],
          [
            summary('zeta_kyc'),
            summary('alpha_kyc'),
            summary('mock_kyc_1'),
            summary('sync_only_kyc', { supportsAsyncCallback: false }),
            summary('smtp', { type: 'email_delivery' }),
            summary('reporting_kyc', { callbackFields: ['kycOutcome'] }),
          ],
        );

        expect(primary).toEqual(
          expect.objectContaining({
            selected: false,
            selectableIds: ['alpha_kyc', 'mock_kyc_1', 'zeta_kyc'],
          }),
        );
      });

      it('judges the candidates against the step as authored, not as selected', () => {
        const primary = describePrimary(
          [{ stepName: 'collect', connectorId: 'veriff_kyc' }],
          [summary('veriff_kyc'), summary('other_kyc')],
        );

        expect(primary.selectableIds).toEqual(['mock_kyc_1', 'other_kyc', 'veriff_kyc']);
      });

      it('lists only the authored and effective ids without rules', () => {
        const [collect] = new Workflow(selectable, undefined, null, [
          { stepName: 'collect', connectorId: 'veriff_kyc' },
        ]).describeDefinition().steps;

        expect(collect.connectors[0].selectableIds).toEqual(['mock_kyc_1', 'veriff_kyc']);
      });

      it('lists sync-only adapters for a synchronous slot', () => {
        const syncDefinition = normalizeUntypedSteps({
          id: 'selectable-sync',
          version: 1,
          initial: 'collect',
          steps: [
            {
              ...SELECTABLE_STEPS[0],
              connectors: [
                { ...((SELECTABLE_STEPS[0].connectors as unknown[])[0] as object), async: false },
              ],
            },
            SELECTABLE_STEPS[1],
          ],
        });

        const [collect] = new Workflow(syncDefinition).describeDefinition(
          undefined,
          rules([summary('sync_only_kyc', { supportsAsyncCallback: false })]),
        ).steps;

        expect(collect.connectors[0].selectableIds).toEqual(['mock_kyc_1', 'sync_only_kyc']);
      });

      it('does not report a selection for a step that cannot take one', () => {
        const primary = describePrimary([{ stepName: 'done', connectorId: 'veriff_kyc' }], []);

        expect(primary.selected).toBe(false);
        expect(primary.id).toBe('mock_kyc_1');
      });

      it('hands the effective declarations to the connector port', async () => {
        const port = {
          execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
          resume: jest.fn(),
        } as unknown as ConnectorExecutionPort;
        const selected = new Workflow(selectable, port, null, [
          { stepName: 'collect', connectorId: 'veriff_kyc' },
        ]);

        await selected.evaluate({
          currentStep: 'collect',
          submittedData: { email: 'a@b.co' },
          onboardingContext: {},
          onboardingId: 'onboarding-1',
          onboardingScores: {},
        });

        const [declarations] = (port.execute as jest.Mock).mock.calls[0];
        expect(declarations).toEqual([
          expect.objectContaining({ id: 'veriff_kyc', config: { marker: 'authored' } }),
        ]);
        expect(selected.findStep('collect')?.connectors[0].id).toBe('veriff_kyc');
      });
    });

    it('projects a file field with its upload constraints', () => {
      const withFile = normalizeUntypedSteps({
        id: 'with-file',
        version: 1,
        initial: 'collect',
        steps: [
          {
            name: 'collect',
            status: 'awaiting_user',
            data: {
              scan: {
                type: 'file',
                required: true,
                persist: false,
                validation: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
              },
            },
            transitions: [{ status: 'success', target: 'done' }],
          },
          { name: 'done', status: 'approved', data: {}, transitions: [] },
        ],
      });

      const [collect] = new Workflow(withFile).describeDefinition().steps;

      expect(collect.fields).toEqual([
        expect.objectContaining({
          name: 'scan',
          type: 'file',
          required: true,
          persist: false,
          when: null,
          upload: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
        }),
      ]);
    });

    describe('source', () => {
      const typed = JSON.parse(
        readFileSync(
          resolve(
            __dirname,
            '../../../../../workflows/built-in/eu-b2c-individual-kyc-eea-v2.workflow.json',
          ),
          'utf8',
        ),
      );
      const report = compileWorkflowReport(typed);
      const described = new Workflow(
        validateAndNormalizeWorkflow(typed),
        undefined,
        null,
      ).describeDefinition(report.steps);

      it('maps every compiled step of a multi-step typed step to its one authored step', () => {
        const otp = report.steps.find((entry) => entry.type === 'otp-verify');

        expect(otp?.compiledStepNames.length).toBeGreaterThan(1);

        for (const compiledName of otp?.compiledStepNames ?? []) {
          expect(described.steps.find((step) => step.name === compiledName)?.source).toEqual({
            step: otp?.name,
            type: 'otp-verify',
            category: otp?.category,
          });
        }
      });

      it('is null without a report', () => {
        const withoutReport = new Workflow(
          validateAndNormalizeWorkflow(typed),
        ).describeDefinition();

        expect(withoutReport.steps.every((step) => step.source === null)).toBe(true);
      });
    });
  });

  describe('agreements', () => {
    /** One step collects two families and a second step collects a third. */
    const declaring = normalizeUntypedSteps({
      id: 'agreement-steps',
      version: 1,
      initial: 'accept_terms',
      agreements: [
        { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
        { key: 'eu-b2c-privacy', step: 'accept_terms', acceptedWhen: 'privacyAccepted' },
        { key: 'eu-b2c-marketing', step: 're_accept_terms', acceptedWhen: 'marketingAccepted' },
      ],
      steps: [
        {
          name: 'accept_terms',
          status: 'awaiting_user',
          data: {
            termsAccepted: { type: 'boolean', required: true, validation: { oneOf: [true] } },
            privacyAccepted: { type: 'boolean', required: true },
          },
          transitions: [{ status: 'success', target: 're_accept_terms' }],
        },
        {
          name: 're_accept_terms',
          status: 'awaiting_user',
          data: { marketingAccepted: { type: 'boolean', required: false } },
          transitions: [{ status: 'success', target: 'approved' }],
        },
        { name: 'approved', status: 'approved', data: {}, transitions: [] },
      ],
    });

    describe('getDeclaredAgreementKeys', () => {
      it('names every declared family, in the order the document declares them', () => {
        expect(new Workflow(declaring).getDeclaredAgreementKeys()).toEqual([
          'eu-b2c-terms',
          'eu-b2c-privacy',
          'eu-b2c-marketing',
        ]);
      });

      it('names nothing when the workflow collects no agreement', () => {
        const withoutAgreements = { ...baseWorkflowConfig };
        delete withoutAgreements.agreements;

        expect(
          new Workflow(normalizeUntypedSteps(withoutAgreements)).getDeclaredAgreementKeys(),
        ).toEqual([]);
      });
    });

    describe('findStepAgreements', () => {
      it('names only the families the given step collects', () => {
        expect(new Workflow(declaring).findStepAgreements('accept_terms')).toEqual([
          { key: 'eu-b2c-terms', step: 'accept_terms', acceptedWhen: 'termsAccepted' },
          { key: 'eu-b2c-privacy', step: 'accept_terms', acceptedWhen: 'privacyAccepted' },
        ]);
      });

      it('names nothing for a step no declaration binds to', () => {
        expect(new Workflow(declaring).findStepAgreements('approved')).toEqual([]);
      });

      it('names nothing for a terminal move, which applied no step', () => {
        expect(new Workflow(declaring).findStepAgreements(null)).toEqual([]);
      });
    });
  });

  let workflow: Workflow;
  let connectorExecutionPort: ConnectorExecutionPort;

  const createFileWorkflow = () => {
    const fileDefinition = normalizeUntypedSteps({
      id: 'file-step',
      version: 1,
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            identityDocument: {
              type: 'file',
              required: true,
              validation: {
                contentTypes: ['image/png', 'image/jpeg'],
                maxSizeBytes: 5242880,
              },
            },
            documentLabel: {
              type: 'text',
              required: true,
              validation: { minLength: 1 },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    return new Workflow(fileDefinition);
  };

  beforeEach(() => {
    connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      resume: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    };
    workflow = new Workflow(definition, connectorExecutionPort);
  });

  describe('resolveEnteredStep', () => {
    /** Branches into two reviews and reconverges, so a terminal move is ambiguous on its own. */
    const forking = normalizeUntypedSteps({
      id: 'forking',
      version: 1,
      initial: 'collect',
      steps: [
        {
          name: 'collect',
          status: 'awaiting_user',
          data: {},
          transitions: [{ status: 'success', target: 'review' }],
        },
        {
          name: 'review',
          status: 'awaiting_manual_review',
          data: {},
          transitions: [
            { status: 'manual.approve', target: 'approved' },
            { status: 'manual.reject', target: 'rejected' },
          ],
        },
        { name: 'approved', status: 'approved', data: {}, transitions: [] },
        { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
      ],
    });
    const workflow = new Workflow(forking);

    it('takes the recorded step when the move named one', () => {
      expect(
        workflow.resolveEnteredStep({
          status: 'awaiting_manual_review',
          fromStep: 'collect',
          appliedStep: 'collect',
          toStep: 'review',
        }),
      ).toBe('review');
    });

    it('names the terminal step from the declared target whose status was recorded', () => {
      expect(
        workflow.resolveEnteredStep({
          status: 'approved',
          fromStep: 'review',
          appliedStep: 'review',
          toStep: null,
        }),
      ).toBe('approved');
      expect(
        workflow.resolveEnteredStep({
          status: 'rejected',
          fromStep: 'review',
          appliedStep: 'review',
          toStep: null,
        }),
      ).toBe('rejected');
    });

    it('falls back to any terminal step carrying the status when nothing names the step left behind', () => {
      expect(
        workflow.resolveEnteredStep({
          status: 'approved',
          fromStep: null,
          appliedStep: null,
          toStep: null,
        }),
      ).toBe('approved');
    });

    it('reports nothing when the revision declares no step that could have produced the status', () => {
      expect(
        workflow.resolveEnteredStep({
          status: 'invalid',
          fromStep: 'review',
          appliedStep: 'review',
          toStep: null,
        }),
      ).toBeNull();
    });
  });

  it('initializes from normalized workflow metadata', () => {
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
      scores: {},
    });
  });

  it('uses ordered synchronous mock kyc connectors in accept_terms while keeping collect_email synchronous', () => {
    expect(definition.stepsByName.collect_email.connectors).toEqual([
      {
        name: 'mock_kyc_1',
        id: 'mock_kyc_1',
        type: 'kyc',
        canReject: false,
        async: false,
        order: 1,
        fieldMapping: { email: 'email' },
        optionalFieldMapping: {},
        config: {},
        ...connectorDefaults,
      },
    ]);

    expect(definition.stepsByName.accept_terms.connectors).toEqual([
      {
        name: 'mock_kyc_1',
        id: 'mock_kyc_1',
        type: 'kyc',
        canReject: false,
        async: false,
        order: 1,
        fieldMapping: { email: 'email' },
        optionalFieldMapping: {},
        config: {},
        ...connectorDefaults,
      },
      {
        name: 'mock_kyc_2',
        id: 'mock_kyc_2',
        type: 'kyc',
        canReject: false,
        async: false,
        order: 2,
        fieldMapping: { email: 'email', acceptedTerms: 'acceptedTerms' },
        optionalFieldMapping: {},
        config: {},
        ...connectorDefaults,
      },
    ]);
  });

  it('resolves effective root notify webhook from the taken transition override/inheritance', () => {
    expect(
      workflow.getEffectiveNotifyWebhookForTransition({
        status: 'success',
        target: 'accept_terms',
        webhook: { notify: false },
      }),
    ).toBeUndefined();
    expect(
      workflow.getEffectiveNotifyWebhookForTransition({
        status: 'success',
        target: 'approved',
      }),
    ).toEqual({
      path: 'notify',
    });
  });

  it('returns undefined when there is no taken transition or no root webhook declaration', () => {
    expect(workflow.getEffectiveNotifyWebhookForTransition(undefined)).toBeUndefined();

    const noWebhookWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'no-webhook',
        version: 1,
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            transitions: [{ status: 'success', target: 'approved' }],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
    );

    expect(
      noWebhookWorkflow.getEffectiveNotifyWebhookForTransition({
        status: 'success',
        target: 'approved',
      }),
    ).toBeUndefined();
  });

  describe('callback-only fields', () => {
    const VERDICT_FIELD = 'providerVerdict';
    const guarded = normalizeUntypedSteps({
      id: 'guarded',
      version: 1,
      initial: 'await_provider',
      steps: [
        {
          name: 'await_provider',
          status: 'awaiting_user',
          data: {
            note: { type: 'text', required: false },
            [VERDICT_FIELD]: { type: 'text', required: false },
          },
          connectors: [
            {
              name: 'provider',
              id: 'mock_async_callback_2',
              type: 'custom',
              async: true,
              order: 1,
              fieldMapping: {},
            },
          ],
          transitions: [{ status: 'success', target: 'approved' }],
        },
        { name: 'approved', status: 'approved', data: {}, transitions: [] },
      ],
    });
    const adapters: ConnectorAdapterSummary[] = [
      {
        id: 'mock_async_callback_2',
        type: 'custom',
        supportsAsyncCallback: true,
        scope: 'fixtures',
        callbackFields: [VERDICT_FIELD],
      },
    ];
    const createGuarded = () => {
      const port: ConnectorExecutionPort = {
        execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        resume: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        listAdapters: () => adapters,
      };

      return { port, workflow: new Workflow(guarded, port) };
    };
    const evaluation = (
      submittedData: unknown,
      continuation?: WorkflowEvaluationInput['continuation'],
    ) => ({
      currentStep: 'await_provider',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
      continuation,
    });

    it('refuses a client submit carrying a field the step binds to an async callback, before any connector runs', async () => {
      const { port, workflow: guardedWorkflow } = createGuarded();

      const result = await guardedWorkflow.evaluate(
        evaluation({ note: 'hello', [VERDICT_FIELD]: 'approved' }),
      );

      expect(result.isRetryableInvalidData()).toBe(true);
      expect(result.getErrors()).toEqual({ [VERDICT_FIELD]: ['CALLBACK_ONLY'] });
      expect(port.execute).not.toHaveBeenCalled();
    });

    it('lets the continuation carry the same field', async () => {
      const { port, workflow: guardedWorkflow } = createGuarded();

      const result = await guardedWorkflow.evaluate(
        evaluation(
          { [VERDICT_FIELD]: 'approved' },
          { resolvedConnector: { connectorOrder: 1, result: ConnectorExecutionResult.accepted() } },
        ),
      );

      expect(result.isAccepted()).toBe(true);
      expect(result.getNextState()?.context).toEqual({ [VERDICT_FIELD]: 'approved' });
      expect(port.resume).toHaveBeenCalled();
    });

    it('accepts a client submit without the field, and guards nothing when the port lists no adapters', async () => {
      const { workflow: guardedWorkflow } = createGuarded();
      const unguarded = new Workflow(guarded, {
        execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        resume: jest.fn(),
      });

      await expect(
        guardedWorkflow.evaluate(evaluation({ note: 'hello' })).then((r) => r.isAccepted()),
      ).resolves.toBe(true);
      await expect(
        unguarded.evaluate(evaluation({ [VERDICT_FIELD]: 'approved' })).then((r) => r.isAccepted()),
      ).resolves.toBe(true);
    });
  });

  it('validates fields, runs connector execution, and resolves the declared non-terminal target', async () => {
    const data = { email: 'person@example.com' };
    const onboardingContext = { firstName: 'Ada' };
    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: data,
      onboardingContext,
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: { firstName: 'Ada', email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        completedAt: null,
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
    expect(result).toBeDefined();
    expect(data).toEqual({ email: 'person@example.com' });
    expect(onboardingContext).toEqual({ firstName: 'Ada' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { firstName: 'Ada', email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(data);
    expect((connectorExecutionPort.execute as jest.Mock).mock.calls[0][1]).not.toBe(
      onboardingContext,
    );

    if (result) {
      const nextState = result.getNextState();
      if (nextState) {
        (nextState.context.email as string) = 'changed@example.com';
      }
    }
    expect(data).toEqual({ email: 'person@example.com' });
    expect(onboardingContext).toEqual({ firstName: 'Ada' });
  });

  it('returns invalid UNKNOWN_STATE for a file step when connector execution rejects the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.invalid()),
    } as unknown as ConnectorExecutionPort;
    const fileWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'file-upload',
        version: 1,
        initial: 'collect_identity',
        steps: [
          {
            name: 'collect_identity',
            status: 'awaiting_user',
            data: {
              identityDocument: {
                type: 'file',
                required: true,
                validation: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
              },
            },
            connectors: [
              {
                name: 'mock_sumsub_file_upload',
                id: 'mock_sumsub_file_upload',
                type: 'kyc',
                order: 1,
                fieldMapping: { documentId: 'identityDocument' },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      connectorExecutionPort,
    );

    const result = await fileWorkflow.evaluate({
      currentStep: 'collect_identity',
      submittedData: { identityDocument: 'document-123' },
      onboardingContext: { persisted: 'value' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_identity');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: 'value' },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('preserves the file-step transition when connector execution accepts the reference', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    } as unknown as ConnectorExecutionPort;
    const fileWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'file-upload',
        version: 1,
        initial: 'collect_identity',
        steps: [
          {
            name: 'collect_identity',
            status: 'awaiting_user',
            data: {
              identityDocument: {
                type: 'file',
                required: true,
                validation: { contentTypes: ['image/png'], maxSizeBytes: 1024 },
              },
              documentLabel: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_sumsub_file_upload',
                id: 'mock_sumsub_file_upload',
                type: 'kyc',
                order: 1,
                fieldMapping: { documentId: 'identityDocument' },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      connectorExecutionPort,
    );

    await expect(
      fileWorkflow.evaluate({
        currentStep: 'collect_identity',
        submittedData: { identityDocument: 'document-123', documentLabel: 'passport' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).resolves.toEqual({
      acceptedData: { identityDocument: 'document-123', documentLabel: 'passport' },
      appliedStep: 'collect_identity',
      nextState: {
        context: { identityDocument: 'document-123', documentLabel: 'passport' },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
  });

  it('resolves terminal state with completedAt from target metadata', async () => {
    const before = Date.now();
    await expect(
      workflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
        onboardingContext: { email: 'person@example.com' },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).resolves.toMatchObject({
      appliedStep: 'accept_terms',
      nextState: {
        context: { email: 'person@example.com', acceptedTerms: true },
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      },
    });
    const evaluation = await workflow.evaluate({
      currentStep: 'accept_terms',
      submittedData: { acceptedTerms: true },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });
    expect(evaluation?.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect((evaluation?.getNextState()?.completedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.accept_terms.connectors,
      { email: 'person@example.com', acceptedTerms: true },
      { onboardingId: 'onboarding-123', stepName: 'accept_terms' },
    );
  });

  it('supports recursive success and manual review outcomes without re-entering the step', async () => {
    const manualWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'manual-review',
        version: 1,
        initial: 'collect_data',
        steps: [
          {
            name: 'collect_data',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            transitions: [{ status: 'success' }, { status: 'manual.invalid', target: 'invalid' }],
          },
          {
            name: 'review',
            status: 'awaiting_manual_review',
            data: {},
            transitions: [
              { status: 'manual.approve', target: 'approved' },
              { status: 'manual.reject', target: 'rejected' },
              { status: 'manual.invalid', target: 'invalid' },
            ],
          },
          {
            name: 'approved',
            status: 'approved',
            data: {},
            transitions: [],
          },
          {
            name: 'rejected',
            status: 'rejected',
            data: {},
            transitions: [],
          },
          {
            name: 'invalid',
            status: 'invalid',
            data: {},
            transitions: [],
          },
        ],
      }),
    );

    await expect(
      manualWorkflow.evaluate({
        currentStep: 'collect_data',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
        onboardingId: '01912345-6789-7abc-8def-0123456789ab',
        onboardingScores: {},
      }),
    ).resolves.toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_data',
      nextState: {
        context: { email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'collect_data',
        completedAt: null,
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });

    expect(
      manualWorkflow.evaluateManual(
        {
          currentStep: 'review',
          submittedData: undefined,
          onboardingContext: { reviewerNote: 'looks-good' },
          onboardingScores: {},
        },
        'manual.approve',
      ),
    ).toEqual({
      acceptedData: {},
      appliedStep: 'review',
      nextState: {
        context: { reviewerNote: 'looks-good' },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });

    expect(
      manualWorkflow.evaluateManual(
        {
          currentStep: 'review',
          submittedData: undefined,
          onboardingContext: { reviewerNote: 'needs-fix' },
          onboardingScores: {},
        },
        'manual.invalid',
      ),
    ).toEqual({
      acceptedData: {},
      appliedStep: 'review',
      nextState: {
        context: { reviewerNote: 'needs-fix' },
        status: 'invalid',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });

    const rejectedManualResult = manualWorkflow.evaluateManual(
      {
        currentStep: 'review',
        submittedData: undefined,
        onboardingContext: { reviewerNote: 'needs-fix' },
        onboardingScores: {},
      },
      'manual.reject',
    );
    expect(rejectedManualResult.getNextState()).toMatchObject({
      status: 'rejected',
      currentStep: null,
      completedAt: expect.any(Date),
      rejectionReason: null,
    });
    expect(rejectedManualResult.getNextState()?.rejectionReason).toBeNull();

    const invalidManualResult = manualWorkflow.evaluateManual(
      {
        currentStep: 'collect_data',
        submittedData: undefined,
        onboardingContext: { reviewerNote: 'n/a' },
        onboardingScores: {},
      },
      'manual.approve',
    );
    expect(invalidManualResult.isManualTransitionUnavailable()).toBe(true);
    expect(invalidManualResult.getReason()).toBe('UNKNOWN_STATE');
  });

  it.each([
    ['missing field', 'collect_email', {}, { email: ['REQUIRED'] }],
    [
      'undeclared field',
      'collect_email',
      { other: 'value' },
      { email: ['REQUIRED'], other: ['UNKNOWN'] },
    ],
    ['wrong type', 'collect_email', { email: 42 }, { email: ['INVALID'] }],
    ['invalid email', 'collect_email', { email: 'invalid' }, { email: ['INVALID'] }],
    ['false const', 'accept_terms', { acceptedTerms: false }, { acceptedTerms: ['INVALID'] }],
    ['malformed body', 'collect_email', null, {}],
    ['array body', 'collect_email', [], {}],
  ])(
    'returns retryable invalid-data for %s runtime input',
    async (_description, currentStep, submittedData, expectedErrors) => {
      const result = await workflow.evaluate({
        currentStep,
        submittedData,
        onboardingContext: { persisted: true },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      });

      expect(result.isRetryableInvalidData()).toBe(true);
      expect(result.getErrors()).toEqual(expectedErrors);
      expect(result.getAppliedStep()).toBe(currentStep);
      expect(result.getNextState()).toBeUndefined();
      expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
    },
  );

  it('returns invalid UNKNOWN_STATE for a terminal step runtime input', async () => {
    const result = await workflow.evaluate({
      currentStep: 'approved',
      submittedData: {},
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBeUndefined();
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('preserves account-number values and copies only declared data while using supported text formatting', async () => {
    const customDefinition = normalizeUntypedSteps({
      id: 'custom',
      version: 1,
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            emailAddress: {
              type: 'text',
              required: true,
              validation: { format: 'email' },
            },
            iban: {
              type: 'text',
              required: true,
              validation: { format: 'account-number' },
            },
            status: {
              type: 'text',
              required: true,
              validation: { oneOf: ['active', 'pending'] },
            },
            tags: {
              type: 'text',
              required: false,
              validation: { manyOf: ['vip', 'urgent'] },
            },
            age: {
              type: 'number',
              required: true,
              validation: { minimum: 18 },
            },
            acceptedTerms: {
              type: 'boolean',
              required: true,
              validation: { oneOf: [true] },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const customWorkflow = new Workflow(customDefinition);
    const submittedData = {
      emailAddress: 'person@example.com',
      iban: '  de89 3704 0044 0532 0130 00 ',
      status: 'active',
      age: 21,
      acceptedTerms: true,
    };

    const result = await customWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: {
        emailAddress: 'person@example.com',
        iban: '  de89 3704 0044 0532 0130 00 ',
        status: 'active',
        age: 21,
        acceptedTerms: true,
      },
      appliedStep: 'collect_data',
      nextState: {
        context: {
          emailAddress: 'person@example.com',
          iban: '  de89 3704 0044 0532 0130 00 ',
          status: 'active',
          age: 21,
          acceptedTerms: true,
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
    expect(submittedData).toEqual({
      emailAddress: 'person@example.com',
      iban: '  de89 3704 0044 0532 0130 00 ',
      status: 'active',
      age: 21,
      acceptedTerms: true,
    });
  });

  it('accepts valid falsy values and keeps submitted input unchanged', async () => {
    const customDefinition = normalizeUntypedSteps({
      id: 'custom-falsy',
      version: 1,
      initial: 'collect_data',
      steps: [
        {
          name: 'collect_data',
          status: 'awaiting_user',
          data: {
            approved: {
              type: 'boolean',
              required: true,
            },
            retries: {
              type: 'number',
              required: true,
              validation: { minimum: 0 },
            },
            note: {
              type: 'text',
              required: true,
              validation: { minLength: 0 },
            },
          },
          transitions: [{ status: 'success', target: 'finished' }],
        },
        {
          name: 'finished',
          status: 'approved',
          data: {},
          transitions: [],
        },
      ],
    });

    const customWorkflow = new Workflow(customDefinition);
    const submittedData = {
      approved: false,
      retries: 0,
      note: '',
    };

    const result = await customWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: {
        approved: false,
        retries: 0,
        note: '',
      },
      appliedStep: 'collect_data',
      nextState: {
        context: {
          approved: false,
          retries: 0,
          note: '',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });

    if (result) {
      const nextState = result.getNextState();
      if (nextState) {
        (nextState.context.note as string) = 'updated';
      }
    }
    expect(submittedData).toEqual({
      approved: false,
      retries: 0,
      note: '',
    });
  });

  it('keeps root structured persist:false out of onboarding context while preserving connector input', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    } as unknown as ConnectorExecutionPort;

    const structuredWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'structured-persist',
        version: 1,
        initial: 'collect',
        steps: [
          {
            name: 'collect',
            status: 'awaiting_user',
            data: {
              profile: {
                type: 'object',
                required: true,
                persist: false,
                fields: {
                  links: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'text',
                      validation: { format: 'uri' },
                    },
                  },
                },
              },
              note: {
                type: 'text',
                required: true,
              },
            },
            connectors: [
              {
                name: 'mock_connector',
                id: 'mock_connector',
                type: 'custom',
                order: 1,
                fieldMapping: { note: 'note' },
              },
            ],
            transitions: [{ status: 'success', target: 'done' }],
          },
          {
            name: 'done',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      connectorExecutionPort,
    );

    const result = await structuredWorkflow.evaluate({
      currentStep: 'collect',
      submittedData: {
        note: 'visible',
        profile: {
          links: ['https://tsh.io/docs'],
        },
      },
      onboardingContext: { source: 'api' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: {
        note: 'visible',
      },
      appliedStep: 'collect',
      nextState: {
        context: {
          source: 'api',
          note: 'visible',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      [
        {
          name: 'mock_connector',
          id: 'mock_connector',
          type: 'custom',
          canReject: false,
          async: false,
          order: 1,
          fieldMapping: { note: 'note' },
          optionalFieldMapping: {},
          config: {},
          ...connectorDefaults,
        },
      ],
      {
        source: 'api',
        note: 'visible',
        profile: {
          links: ['https://tsh.io/docs'],
        },
      },
      { onboardingId: 'onboarding-123', stepName: 'collect' },
    );
  });

  it('keeps root array and structured persist:true values in accepted data, connector payload, and context', async () => {
    const execute = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());

    const structuredWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'structured-persist-true',
        version: 1,
        initial: 'collect',
        steps: [
          {
            name: 'collect',
            status: 'awaiting_user',
            data: {
              cards: {
                type: 'array',
                required: true,
                items: {
                  type: 'text',
                  validation: { format: 'email' },
                },
              },
              profile: {
                type: 'object',
                required: true,
                fields: {
                  links: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'text',
                      validation: { format: 'uri' },
                    },
                  },
                },
              },
              metadata: {
                type: 'object',
                required: true,
                persist: true,
                fields: {
                  profileId: {
                    type: 'text',
                    required: true,
                    validation: { format: 'uuid' },
                  },
                },
              },
            },
            connectors: [
              {
                name: 'mock_connector',
                id: 'mock_connector',
                type: 'custom',
                order: 1,
                fieldMapping: { profileId: 'metadata' },
              },
            ],
            transitions: [{ status: 'success', target: 'done' }],
          },
          {
            name: 'done',
            status: 'approved',
            data: {},
            transitions: [],
          },
        ],
      }),
      { execute, resume: jest.fn() },
    );

    const submittedData = {
      cards: ['person@example.com'],
      profile: {
        links: ['https://tsh.io/docs'],
      },
      metadata: {
        profileId: '550e8400-e29b-41d4-a716-446655440000',
      },
    };

    await expect(
      structuredWorkflow.evaluate({
        currentStep: 'collect',
        submittedData,
        onboardingContext: { source: 'api' },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).resolves.toEqual({
      acceptedData: {
        cards: ['person@example.com'],
        profile: {
          links: ['https://tsh.io/docs'],
        },
        metadata: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
      appliedStep: 'collect',
      nextState: {
        context: {
          source: 'api',
          cards: ['person@example.com'],
          profile: {
            links: ['https://tsh.io/docs'],
          },
          metadata: {
            profileId: '550e8400-e29b-41d4-a716-446655440000',
          },
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });

    expect(execute).toHaveBeenCalledWith(
      [
        {
          name: 'mock_connector',
          id: 'mock_connector',
          type: 'custom',
          canReject: false,
          async: false,
          order: 1,
          fieldMapping: { profileId: 'metadata' },
          optionalFieldMapping: {},
          config: {},
          ...connectorDefaults,
        },
      ],
      {
        source: 'api',
        cards: ['person@example.com'],
        profile: {
          links: ['https://tsh.io/docs'],
        },
        metadata: {
          profileId: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
      { onboardingId: 'onboarding-123', stepName: 'collect' },
    );
  });

  it('exposes active file-field metadata and accepts a valid document id with sibling fields', async () => {
    const fileWorkflow = createFileWorkflow();
    const submittedData = {
      documentLabel: 'passport',
      identityDocument: 'document-123',
    };

    const result = await fileWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData,
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(fileWorkflow.getActiveFileFieldMetadata('collect_data')).toEqual({
      fieldName: 'identityDocument',
      field: {
        type: 'file',
        required: true,
        persist: true,
        validation: {
          contentTypes: ['image/png', 'image/jpeg'],
          maxSizeBytes: 5242880,
        },
      },
    });
    expect(result).toEqual({
      appliedStep: 'collect_data',
      acceptedData: {
        documentLabel: 'passport',
        identityDocument: 'document-123',
      },
      nextState: {
        context: {
          documentLabel: 'passport',
          identityDocument: 'document-123',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
    expect(submittedData).toEqual({
      documentLabel: 'passport',
      identityDocument: 'document-123',
    });
  });

  it('rejects missing, empty, or wrong-type file document data without mutating the body', async () => {
    const fileWorkflow = createFileWorkflow();

    for (const submittedData of [
      { documentLabel: 'passport' },
      { documentLabel: 'passport', identityDocument: '' },
      { documentLabel: 'passport', identityDocument: 123 },
    ]) {
      const clone = { ...submittedData };
      const result = await fileWorkflow.evaluate({
        currentStep: 'collect_data',
        submittedData: clone,
        onboardingContext: {},
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      });
      expect(result.isRetryableInvalidData()).toBe(true);
      expect(result.getAppliedStep()).toBe('collect_data');
      expect(result.getNextState()).toBeUndefined();
      expect(clone).toEqual(submittedData);
    }
  });

  it('returns invalid UNKNOWN_STATE for an unknown server-held current step without mutating the body', async () => {
    const data = { email: 'person@example.com' };

    const result = await workflow.evaluate({
      currentStep: 'missing-step',
      submittedData: data,
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBeUndefined();
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('returns invalid UNKNOWN_STATE when connector execution returns invalid', async () => {
    const data = { email: 'person@example.com' };
    (connectorExecutionPort.execute as jest.Mock).mockResolvedValueOnce(
      ConnectorExecutionResult.invalid(),
    );

    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: data,
      onboardingContext: { firstName: 'Ada' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toMatchObject({
      context: { firstName: 'Ada' },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
    expect(data).toEqual({ email: 'person@example.com' });
    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_email.connectors,
      { firstName: 'Ada', email: 'person@example.com' },
      { onboardingId: 'onboarding-123', stepName: 'collect_email' },
    );
  });

  it('awaits connector execution before returning a successful transition', async () => {
    let resolveExecution: ((value: ConnectorExecutionResult) => void) | undefined;
    const executionPromise = new Promise<ConnectorExecutionResult>((resolve) => {
      resolveExecution = resolve;
    });
    connectorExecutionPort.execute = jest.fn().mockReturnValue(executionPromise);
    workflow = new Workflow(definition, connectorExecutionPort);

    let settled = false;
    const evaluationPromise = workflow
      .evaluate({
        currentStep: 'collect_email',
        submittedData: { email: 'person@example.com' },
        onboardingContext: { alias: 'legacy' },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      })
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(connectorExecutionPort.execute).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveExecution?.(ConnectorExecutionResult.accepted());
    await expect(evaluationPromise).resolves.toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: { alias: 'legacy', email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        completedAt: null,
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });
  });

  it('returns a parked async-callback evaluation when connector execution yields pending', async () => {
    (connectorExecutionPort.execute as jest.Mock).mockResolvedValueOnce(
      ConnectorExecutionResult.pending({
        connectorName: 'mock_async_callback',
        connectorId: 'mock_async_callback',
        connectorOrder: 1,
        providerReference: 'session-1',
      }),
    );

    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: { email: 'person@example.com' },
      onboardingContext: { existing: 'value' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isParkedAsyncCallback()).toBe(true);
    const pending = {
      connectorName: 'mock_async_callback',
      connectorId: 'mock_async_callback',
      connectorOrder: 1,
      providerReference: 'session-1',
    };
    expect(result.getPendingConnector()).toEqual(pending);
    expect(result.getTakenTransition()).toBeUndefined();
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toEqual({
      context: { existing: 'value', email: 'person@example.com' },
      status: 'awaiting_user',
      currentStep: 'collect_email',
      completedAt: null,
      rejectionReason: null,
      scores: {},
      pendingConnector: pending,
    });
  });

  it('keeps non-final verifyCode invalid-data retryable without terminal next state', async () => {
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-invalid-data',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue(
          ConnectorExecutionResult.invalidData(
            { verificationCode: ['INVALID'] },
            {
              [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
            },
          ),
        ),
        resume: jest.fn(),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(result.getErrors()).toEqual({ verificationCode: ['INVALID'] });
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toBeUndefined();
  });

  it('routes accepted verifyCode outcome with non-persistent code while preserving connector access', async () => {
    const execute = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-accepted',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                persist: false,
                validation: { minLength: 1 },
              },
              notes: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      { execute, resume: jest.fn() },
    );

    await expect(
      otpWorkflow.evaluate({
        currentStep: 'verify_code',
        submittedData: { verificationCode: '123456', notes: 'keep-this' },
        onboardingContext: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
        },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).resolves.toEqual({
      acceptedData: { notes: 'keep-this' },
      appliedStep: 'verify_code',
      nextState: {
        context: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
          notes: 'keep-this',
        },
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: null,
        scores: {},
        pendingConnector: null,
      },
    });

    expect(execute).toHaveBeenCalledWith(
      expect.any(Array),
      {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
        verificationCode: '123456',
        notes: 'keep-this',
      },
      { onboardingId: 'onboarding-123', stepName: 'verify_code' },
    );

    const acceptedResult = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '123456', notes: 'keep-this' },
      onboardingContext: {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
      },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });
    expect(acceptedResult.getNextState()?.context.verificationCode).toBeUndefined();
  });

  it('routes rejected verifyCode outcome with non-persistent code while preserving unrelated context fields', async () => {
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-rejected',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                persist: false,
                validation: { minLength: 1 },
              },
              notes: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('ATTEMPTS_EXHAUSTED')),
        resume: jest.fn(),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000', notes: 'keep-on-reject' },
      onboardingContext: {
        email: 'person@example.com',
        code: 'legacy-code',
        journeyId: 'journey-1',
      },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: { notes: 'keep-on-reject' },
      appliedStep: 'verify_code',
      nextState: {
        context: {
          email: 'person@example.com',
          code: 'legacy-code',
          journeyId: 'journey-1',
          notes: 'keep-on-reject',
        },
        status: 'rejected',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: 'ATTEMPTS_EXHAUSTED',
        scores: {},
        pendingConnector: null,
      },
    });
    expect(result.isRejected()).toBe(true);
    expect(result.getRejectionReason()).toBe('ATTEMPTS_EXHAUSTED');
    expect(result.getNextState()?.context.verificationCode).toBeUndefined();
  });

  it('routes rejected non-verifyCode connector outcome through rejected transition with accepted data persisted in context', async () => {
    const genericRejectingWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'generic-rejected',
        version: 1,
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            connectors: [
              {
                name: 'mock_kyc',
                id: 'mock_kyc_1',
                type: 'kyc',
                canReject: true,
                order: 1,
                fieldMapping: { email: 'email' },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')),
        resume: jest.fn(),
      },
    );

    const result = await genericRejectingWorkflow.evaluate({
      currentStep: 'collect_email',
      submittedData: { email: 'person@example.com' },
      onboardingContext: { onboardingSource: 'test' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result).toEqual({
      acceptedData: { email: 'person@example.com' },
      appliedStep: 'collect_email',
      nextState: {
        context: {
          onboardingSource: 'test',
          email: 'person@example.com',
        },
        status: 'rejected',
        currentStep: null,
        completedAt: expect.any(Date),
        rejectionReason: 'CONNECTOR_REJECTED',
        scores: {},
        pendingConnector: null,
      },
    });
    expect(result.isRejected()).toBe(true);
    expect(result.getRejectionReason()).toBe('CONNECTOR_REJECTED');
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('selects the first matching conditional transition and falls back to the unconditional route', async () => {
    const conditionalWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'conditional-transition',
        version: 1,
        initial: 'collect_data',
        steps: [
          {
            name: 'collect_data',
            status: 'awaiting_user',
            data: {
              country: { type: 'text', required: true },
              taxId: { type: 'text', required: false },
            },
            transitions: [
              {
                status: 'success',
                when: { field: 'country', equals: 'US' },
                target: 'us_review',
              },
              { status: 'success', target: 'standard_review' },
            ],
          },
          {
            name: 'us_review',
            status: 'awaiting_user',
            data: {},
            transitions: [{ status: 'success', target: 'finished' }],
          },
          {
            name: 'standard_review',
            status: 'awaiting_user',
            data: {},
            transitions: [{ status: 'success', target: 'finished' }],
          },
          { name: 'finished', status: 'approved', data: {}, transitions: [] },
        ],
      }),
    );

    const conditionalResult = await conditionalWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData: { country: 'US', taxId: 'abc' },
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(conditionalResult.getTakenTransition()?.target).toBe('us_review');
    expect(conditionalResult.getNextState()).toMatchObject({
      status: 'awaiting_user',
      currentStep: 'us_review',
    });

    const fallbackResult = await conditionalWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData: { country: 'CA' },
      onboardingContext: {},
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(fallbackResult.getTakenTransition()?.target).toBe('standard_review');
    expect(fallbackResult.getNextState()).toMatchObject({
      status: 'awaiting_user',
      currentStep: 'standard_review',
    });
  });

  it('keeps cross-step missing mapped sources fail-fast at runtime when a predecessor conditional field is absent', async () => {
    const execute = jest
      .fn()
      .mockRejectedValue(
        new ConnectorPayloadFieldNotFoundError('taxId', 'mock_connector', 'cross_step_connector'),
      );
    const crossStepWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'cross-step-missing-runtime',
        version: 1,
        initial: 'collect_country',
        steps: [
          {
            name: 'collect_country',
            status: 'awaiting_user',
            data: {
              country: { type: 'text', required: true },
              taxId: {
                type: 'text',
                required: true,
                when: { field: 'country', equals: 'US' },
              },
            },
            transitions: [{ status: 'success', target: 'verify_identity' }],
          },
          {
            name: 'verify_identity',
            status: 'awaiting_user',
            data: {
              acceptedTerms: { type: 'boolean', required: true, validation: { oneOf: [true] } },
            },
            connectors: [
              {
                name: 'cross_step_connector',
                id: 'mock_connector',
                type: 'custom',
                order: 1,
                fieldMapping: {
                  country: 'country',
                  taxId: 'taxId',
                  acceptedTerms: 'acceptedTerms',
                },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      }),
      { execute } as unknown as ConnectorExecutionPort,
    );

    await expect(
      crossStepWorkflow.evaluate({
        currentStep: 'verify_identity',
        submittedData: { acceptedTerms: true },
        onboardingContext: { country: 'CA' },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).rejects.toBeInstanceOf(ConnectorPayloadFieldNotFoundError);

    expect(execute).toHaveBeenCalledWith(
      [
        {
          name: 'cross_step_connector',
          id: 'mock_connector',
          type: 'custom',
          canReject: false,
          async: false,
          order: 1,
          fieldMapping: {
            country: 'country',
            taxId: 'taxId',
            acceptedTerms: 'acceptedTerms',
          },
          optionalFieldMapping: {},
          config: {},
          ...connectorDefaults,
        },
      ],
      { country: 'CA', acceptedTerms: true },
      { onboardingId: 'onboarding-123', stepName: 'verify_identity' },
    );
    expect(execute.mock.calls[0]).toHaveLength(3);
  });

  it('uses the current unprojected submission for conditional transition evaluation even when the field is persist:false', async () => {
    const persistFalseWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'persist-false-conditional',
        version: 1,
        initial: 'collect_code',
        steps: [
          {
            name: 'collect_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                persist: false,
              },
            },
            transitions: [
              {
                status: 'success',
                when: { field: 'verificationCode', equals: '123456' },
                target: 'approved',
              },
              { status: 'success', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
    );

    const result = await persistFalseWorkflow.evaluate({
      currentStep: 'collect_code',
      submittedData: { verificationCode: '123456' },
      onboardingContext: { existing: 'value' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.getTakenTransition()?.target).toBe('approved');
    expect(result.getNextState()).toMatchObject({
      context: { existing: 'value' },
      status: 'approved',
      currentStep: null,
    });
    expect(result.getAcceptedData()).toEqual({});
  });

  it('uses the rejected transition for connector rejections and manual evaluation uses persisted context only', async () => {
    const manualWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'connector-rejected-manual',
        version: 1,
        initial: 'collect_data',
        steps: [
          {
            name: 'collect_data',
            status: 'awaiting_user',
            data: {
              email: { type: 'text', required: true },
            },
            connectors: [
              {
                name: 'mock',
                id: 'mock',
                type: 'custom',
                canReject: true,
                order: 1,
                fieldMapping: { email: 'email' },
              },
            ],
            transitions: [
              { status: 'success', target: 'review' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          {
            name: 'review',
            status: 'awaiting_manual_review',
            data: {},
            transitions: [{ status: 'manual.approve', target: 'approved' }],
          },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')),
        resume: jest.fn(),
      },
    );

    const connectorResult = await manualWorkflow.evaluate({
      currentStep: 'collect_data',
      submittedData: { email: 'person@example.com' },
      onboardingContext: { persisted: 'state' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(connectorResult.isRejected()).toBe(true);
    expect(connectorResult.getRejectionReason()).toBe('CONNECTOR_REJECTED');
    expect(connectorResult.getNextState()).toMatchObject({
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'CONNECTOR_REJECTED',
    });

    const manualResult = manualWorkflow.evaluateManual(
      {
        currentStep: 'review',
        submittedData: { email: 'ignored' },
        onboardingContext: { persisted: 'state' },
        onboardingScores: {},
      },
      'manual.approve',
    );

    expect(manualResult.getNextState()).toMatchObject({
      status: 'approved',
      context: { persisted: 'state' },
    });
  });

  it('returns manual-transition-unavailable when a manual condition does not match', () => {
    const manualWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'manual-no-match',
        version: 1,
        initial: 'collect_data',
        steps: [
          {
            name: 'collect_data',
            status: 'awaiting_user',
            data: {
              email: { type: 'text', required: true },
            },
            transitions: [{ status: 'success', target: 'review' }],
          },
          {
            name: 'review',
            status: 'awaiting_manual_review',
            data: {
              country: { type: 'text', required: true },
            },
            transitions: [
              {
                status: 'manual.approve',
                when: { field: 'country', equals: 'US' },
                target: 'approved',
              },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      }),
    );

    const result = manualWorkflow.evaluateManual(
      {
        currentStep: 'review',
        onboardingContext: { country: 'CA' },
        onboardingScores: {},
      },
      'manual.approve',
    );

    expect(result.isManualTransitionUnavailable()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
  });

  it('returns retryable invalid-data with field errors for step-level validation failures', async () => {
    const result = await workflow.evaluate({
      currentStep: 'collect_email',
      submittedData: { email: 'invalid-email' },
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(result.getErrors()).toEqual({ email: ['INVALID'] });
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toBeUndefined();
  });

  it('defaults missing invalid-data errors to an empty object for retryable verify-code outcomes', async () => {
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-missing-invalid-data-errors',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                persist: false,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue({
          isAccepted: () => false,
          isInvalid: () => false,
          isInvalidData: () => true,
          isRejected: () => false,
          metadata: {
            [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true,
          },
        } as unknown as ConnectorExecutionResult),
        resume: jest.fn(),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(result.getErrors()).toEqual({});
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toBeUndefined();
  });

  it('returns terminal invalid UNKNOWN_STATE for invalid-data without retryable metadata', async () => {
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-non-retryable-invalid-data',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [
              { status: 'success', target: 'approved' },
              { status: 'rejected', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(
            ConnectorExecutionResult.invalidData({ verificationCode: ['INVALID'] }),
          ),
        resume: jest.fn(),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toMatchObject({
      context: { email: 'person@example.com' },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('defaults missing rejection reason to CONNECTOR_REJECTED and preserves rejected transition behavior', async () => {
    const otpWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'otp-missing-rejection-reason',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'mock_phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                canReject: true,
                order: 1,
                fieldMapping: { code: 'verificationCode' },
                optionalFieldMapping: {},
                config: { operation: 'verifyCode', maxAttempts: 3 },
              },
            ],
            transitions: [{ status: 'rejected', target: 'rejected' }],
          },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue({
          isAccepted: () => false,
          isInvalid: () => false,
          isInvalidData: () => false,
          isRejected: () => true,
          isPending: () => false,
          reason: undefined,
        } as unknown as ConnectorExecutionResult),
        resume: jest.fn(),
      },
    );

    const result = await otpWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { email: 'person@example.com' },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isRejected()).toBe(true);
    expect(result.getRejectionReason()).toBe('CONNECTOR_REJECTED');
    expect(result.getNextState()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'CONNECTOR_REJECTED',
    });
  });

  it('propagates connector execution faults without converting them to workflow results', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockRejectedValue(new Error('connector exploded')),
    } as unknown as ConnectorExecutionPort;
    const workflowWithFault = new Workflow(
      normalizeUntypedSteps({
        id: 'fault-propagation',
        version: 1,
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      }),
      connectorExecutionPort,
    );

    await expect(
      workflowWithFault.evaluate({
        currentStep: 'collect_email',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      }),
    ).rejects.toThrow('connector exploded');
  });

  it('returns invalid UNKNOWN_STATE when success transition is missing for accepted connector output', async () => {
    const invalidWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'missing-success',
        version: 1,
        initial: 'collect_email',
        steps: [
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: {
                type: 'text',
                required: true,
                validation: { format: 'email' },
              },
            },
            transitions: [{ status: 'manual.reject', target: 'rejected' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
        resume: jest.fn(),
      },
    );

    const result = await invalidWorkflow.evaluate({
      currentStep: 'collect_email',
      submittedData: { email: 'person@example.com' },
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('collect_email');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  it('returns invalid UNKNOWN_STATE when rejected transition is missing for rejected connector output', async () => {
    const invalidWorkflow = new Workflow(
      normalizeUntypedSteps({
        id: 'missing-rejected',
        version: 1,
        initial: 'verify_code',
        steps: [
          {
            name: 'verify_code',
            status: 'awaiting_user',
            data: {
              verificationCode: {
                type: 'text',
                required: true,
                validation: { minLength: 1 },
              },
            },
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      }),
      {
        execute: jest
          .fn()
          .mockResolvedValue(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED')),
        resume: jest.fn(),
      },
    );

    const result = await invalidWorkflow.evaluate({
      currentStep: 'verify_code',
      submittedData: { verificationCode: '000000' },
      onboardingContext: { persisted: true },
      onboardingId: 'onboarding-123',
      onboardingScores: {},
    });

    expect(result.isTerminalInvalid()).toBe(true);
    expect(result.getReason()).toBe('UNKNOWN_STATE');
    expect(result.getAppliedStep()).toBe('verify_code');
    expect(result.getNextState()).toMatchObject({
      context: { persisted: true },
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(result.getNextState()?.completedAt).toBeInstanceOf(Date);
  });

  describe('evaluate continuation', () => {
    it('passes the resolved connector result to resume so callbacks can drive transitions', async () => {
      const resume = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
      const execute = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
      const callbackWorkflow = new Workflow(
        normalizeUntypedSteps({
          id: 'continuation-continue',
          version: 1,
          initial: 'accept_terms',
          steps: [
            {
              name: 'accept_terms',
              status: 'awaiting_user',
              data: {
                acceptedTerms: {
                  type: 'boolean',
                  required: true,
                  validation: { oneOf: [true] },
                },
              },
              connectors: [
                {
                  name: 'mock_async_callback_1',
                  id: 'mock_async_callback',
                  type: 'custom',
                  async: true,
                  order: 1,
                  fieldMapping: { acceptedTerms: 'acceptedTerms' },
                },
                {
                  name: 'mock_async_callback_2',
                  id: 'mock_async_callback',
                  type: 'custom',
                  async: true,
                  order: 2,
                  fieldMapping: { acceptedTerms: 'acceptedTerms' },
                },
              ],
              transitions: [{ status: 'success', target: 'approved' }],
            },
            { name: 'approved', status: 'approved', data: {}, transitions: [] },
          ],
        }),
        {
          execute,
          resume,
        },
      );

      const resolvedResult = ConnectorExecutionResult.accepted();
      const result = await callbackWorkflow.evaluate({
        currentStep: 'accept_terms',
        submittedData: { acceptedTerms: true },
        onboardingContext: { email: 'person@example.com' },
        onboardingId: 'onboarding-123',
        onboardingScores: {},
        continuation: {
          resolvedConnector: {
            connectorOrder: 1,
            result: resolvedResult,
          },
        },
      });

      expect(result.isAccepted()).toBe(true);
      expect(resume).toHaveBeenCalledWith(
        expect.any(Array),
        { email: 'person@example.com', acceptedTerms: true },
        { onboardingId: 'onboarding-123', stepName: 'accept_terms' },
        1,
        resolvedResult,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it('keeps ordinary two-argument synchronous evaluation unchanged when continuation is not provided', async () => {
      const resume = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
      const execute = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
      const callbackWorkflow = new Workflow(definition, {
        execute,
        resume,
      });

      await callbackWorkflow.evaluate({
        currentStep: 'collect_email',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
        onboardingId: 'onboarding-123',
        onboardingScores: {},
      });

      expect(execute).toHaveBeenCalledTimes(1);
      expect(resume).not.toHaveBeenCalled();
    });
  });
  describe('findStepDescription', () => {
    it.each([
      ['a missing current step', null],
      ['an unknown current step', 'not_a_step'],
      ['a terminal step', 'approved'],
    ])('returns no renderable step for %s', (_description, currentStep) => {
      expect(workflow.findStepDescription(currentStep)).toBeUndefined();
    });

    it('describes the active step controls against the persisted onboarding context', () => {
      expect(workflow.findStepDescription('accept_terms', { email: 'person@example.com' })).toEqual(
        {
          name: 'accept_terms',
          status: 'awaiting_user',
          canSubmit: true,
          fields: [
            {
              name: 'acceptedTerms',
              type: 'boolean',
              required: true,
              active: true,
              dependsOn: [],
              schema: { type: 'boolean', enum: [true] },
              value: null,
            },
          ],
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { acceptedTerms: { type: 'boolean', enum: [true] } },
            required: ['acceptedTerms'],
          },
        },
      );
    });

    it('exposes file upload constraints that the step data schema cannot express', () => {
      const description = createFileWorkflow().findStepDescription('collect_data');

      expect(description?.fields[0]).toEqual({
        name: 'identityDocument',
        type: 'file',
        required: true,
        active: true,
        dependsOn: [],
        schema: { type: 'string', minLength: 1 },
        value: null,
        upload: {
          contentTypes: ['image/png', 'image/jpeg'],
          maxSizeBytes: 5242880,
        },
      });
    });
  });

  describe('scoring', () => {
    const buildScoringDefinition = () =>
      normalizeUntypedSteps({
        id: 'scoring-evaluate',
        version: 1,
        initial: 'collect_profile',
        scoring: { risk: { min: 0, max: 100 } },
        steps: [
          {
            name: 'collect_profile',
            status: 'awaiting_user',
            data: {
              country: { type: 'text', required: true },
              highRiskChannel: { type: 'boolean', required: true, persist: false },
            },
            scoring: [
              { score: 'risk', when: { field: 'country', in: ['RU', 'IR'] }, add: 40 },
              { score: 'risk', when: { field: 'country', equals: 'PL' }, add: -10 },
              { score: 'risk', when: { field: 'highRiskChannel', equals: true }, add: 20 },
              { score: 'risk', add: 5 },
            ],
            transitions: [
              { status: 'success', when: { score: 'risk', gte: 60 }, target: 'manual_review' },
              { status: 'success', target: 'approved' },
            ],
          },
          {
            name: 'manual_review',
            status: 'awaiting_manual_review',
            data: {},
            transitions: [
              { status: 'manual.approve', target: 'approved' },
              { status: 'manual.reject', target: 'rejected' },
            ],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
          { name: 'rejected', status: 'rejected', data: {}, transitions: [] },
        ],
      });

    it('routes to the score-gated arm once the submit rules cross the threshold', async () => {
      const scoringWorkflow = new Workflow(buildScoringDefinition());

      const result = await scoringWorkflow.evaluate({
        currentStep: 'collect_profile',
        submittedData: { country: 'RU', highRiskChannel: true },
        onboardingContext: {},
        onboardingId: 'onboarding-scoring',
        onboardingScores: { risk: 0 },
      });

      // RU (+40) + highRiskChannel (+20) + unconditional (+5) = 65, past the gte: 60 threshold.
      expect(result.isAccepted()).toBe(true);
      expect(result.getNextState()?.currentStep).toBe('manual_review');
      expect(result.getNextState()?.scores).toEqual({ risk: 65 });
    });

    it('falls through to the unconditional arm and clamps once when the sum stays below the threshold', async () => {
      const scoringWorkflow = new Workflow(buildScoringDefinition());

      const result = await scoringWorkflow.evaluate({
        currentStep: 'collect_profile',
        submittedData: { country: 'PL', highRiskChannel: false },
        onboardingContext: {},
        onboardingId: 'onboarding-scoring',
        onboardingScores: { risk: 0 },
      });

      // PL (-10) + unconditional (+5) = -5, clamped once to the declared min of 0.
      expect(result.isAccepted()).toBe(true);
      expect(result.getNextState()?.status).toBe('approved');
      expect(result.getNextState()?.scores).toEqual({ risk: 0 });
    });

    it('drives a score from a persist:false field even though it never reaches the persisted context', async () => {
      const scoringWorkflow = new Workflow(buildScoringDefinition());

      const result = await scoringWorkflow.evaluate({
        currentStep: 'collect_profile',
        submittedData: { country: 'PL', highRiskChannel: true },
        onboardingContext: {},
        onboardingId: 'onboarding-scoring',
        onboardingScores: { risk: 0 },
      });

      // PL (-10) + highRiskChannel (+20) + unconditional (+5) = 15, driven by a field the rules
      // read from the connector context, even though it never lands in the persisted context.
      expect(result.getNextState()?.scores).toEqual({ risk: 15 });
      expect(result.getNextState()?.context).not.toHaveProperty('highRiskChannel');
    });

    it('leaves scores unchanged on evaluateManual, since a manual decision submits no step data', () => {
      const manualScoringDefinition = normalizeUntypedSteps({
        id: 'scoring-manual',
        version: 1,
        initial: 'manual_review',
        scoring: { risk: { min: 0, max: 100 } },
        steps: [
          {
            name: 'manual_review',
            status: 'awaiting_manual_review',
            data: {},
            transitions: [{ status: 'manual.approve', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      });
      const manualScoringWorkflow = new Workflow(manualScoringDefinition);

      const result = manualScoringWorkflow.evaluateManual(
        {
          currentStep: 'manual_review',
          onboardingContext: {},
          onboardingScores: { risk: 65 },
        },
        'manual.approve',
      );

      expect(result.isAccepted()).toBe(true);
      expect(result.getNextState()?.scores).toEqual({ risk: 65 });
    });

    it('leaves scores unchanged on a parked async connector, and applies the rule exactly once on resume', async () => {
      const asyncScoringDefinition = normalizeUntypedSteps({
        id: 'scoring-async',
        version: 1,
        initial: 'collect_profile',
        scoring: { risk: { min: 0, max: 100 } },
        steps: [
          {
            name: 'collect_profile',
            status: 'awaiting_user',
            data: {
              country: { type: 'text', required: true },
            },
            connectors: [
              {
                name: 'mock_async_scoring_connector',
                id: 'mock_async_scoring_connector',
                type: 'custom',
                async: true,
                order: 1,
                fieldMapping: { country: 'country' },
              },
            ],
            scoring: [{ score: 'risk', when: { field: 'country', equals: 'RU' }, add: 40 }],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ],
      });

      const execute = jest.fn().mockResolvedValue(
        ConnectorExecutionResult.pending({
          connectorName: 'mock_async_scoring_connector',
          connectorId: 'mock_async_scoring_connector',
          connectorOrder: 1,
        }),
      );
      const resume = jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted());
      const asyncScoringWorkflow = new Workflow(asyncScoringDefinition, { execute, resume });

      const parkedResult = await asyncScoringWorkflow.evaluate({
        currentStep: 'collect_profile',
        submittedData: { country: 'RU' },
        onboardingContext: {},
        onboardingId: 'onboarding-scoring-async',
        onboardingScores: { risk: 0 },
      });

      expect(parkedResult.isParkedAsyncCallback()).toBe(true);
      expect(parkedResult.getNextState()?.scores).toEqual({ risk: 0 });

      const resumedResult = await asyncScoringWorkflow.evaluate({
        currentStep: 'collect_profile',
        submittedData: { country: 'RU' },
        onboardingContext: {},
        onboardingId: 'onboarding-scoring-async',
        onboardingScores: { risk: 0 },
        continuation: {
          resolvedConnector: {
            connectorOrder: 1,
            result: ConnectorExecutionResult.accepted(),
          },
        },
      });

      expect(resumedResult.isAccepted()).toBe(true);
      expect(resumedResult.getNextState()?.scores).toEqual({ risk: 40 });
    });
  });
});
