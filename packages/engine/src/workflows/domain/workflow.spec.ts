import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type { ConnectorExecutionPort } from '../../connectors/ports/connector-execution.port';
import { Workflow } from './workflow';

const baseWorkflowConfigPath = resolve(__dirname, '../../../../../workflows/base.workflow.json');
const baseWorkflowConfig = JSON.parse(readFileSync(baseWorkflowConfigPath, 'utf8'));

describe('Workflow', () => {
  const definition = validateAndNormalizeWorkflow(baseWorkflowConfig);
  let workflow: Workflow;
  let connectorExecutionPort: ConnectorExecutionPort;

  beforeEach(() => {
    connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(undefined),
    };
    workflow = new Workflow(definition, connectorExecutionPort);
  });

  it('initializes from normalized workflow metadata', () => {
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_contact',
    });
  });

  it('describes the active step with safe, client-renderable field metadata', () => {
    expect(workflow.describeActiveStep('collect_contact')).toEqual({
      stepId: 'collect_contact',
      fields: [
        {
          name: 'email',
          type: 'string',
          required: true,
          persist: true,
          validation: { kind: 'email' },
        },
        {
          name: 'phone',
          type: 'string',
          required: true,
          persist: true,
          validation: { kind: 'phone' },
        },
        {
          name: 'acceptedTerms',
          type: 'boolean',
          required: true,
          persist: false,
          validation: { kind: 'must-be-true' },
        },
        {
          name: 'privacyAcknowledged',
          type: 'boolean',
          required: true,
          persist: false,
          validation: { kind: 'must-be-true' },
        },
        {
          name: 'marketingConsent',
          type: 'boolean',
          required: false,
          persist: false,
          validation: { kind: 'must-be-true' },
        },
      ],
    });
  });

  it('returns null descriptor when there is no active step', () => {
    expect(workflow.describeActiveStep(null)).toBeNull();
  });

  it('accepts a valid contact payload, runs connectors, and assigns server-owned consent evidence', async () => {
    const data = {
      email: 'person@example.com',
      phone: '+48123456789',
      acceptedTerms: true,
      privacyAcknowledged: true,
      marketingConsent: true,
    };

    const result = await workflow.evaluate({
      currentStep: 'collect_contact',
      submittedData: data,
      onboardingContext: {},
    });

    expect(result).toMatchObject({
      appliedStep: 'collect_contact',
      status: 'approved',
      currentStep: null,
      terminal: true,
    });

    if (result?.kind !== 'accepted') {
      throw new Error('Expected an accepted workflow evaluation result');
    }

    expect(result.acceptedData).toEqual(
      expect.objectContaining({
        'contact.email': 'person@example.com',
        'contact.phone': '+48123456789',
        'consent.termsVersion': 'v1',
        'consent.termsAcceptedAt': expect.any(String),
        'consent.privacyVersion': 'v1',
        'consent.privacyAcknowledgedAt': expect.any(String),
        'consent.marketingConsent': true,
        'consent.marketingConsentRecordedAt': expect.any(String),
      }),
    );

    expect(connectorExecutionPort.execute).toHaveBeenCalledWith(
      definition.stepsByName.collect_contact.connectors,
      {
        email: 'person@example.com',
        phone: '+48123456789',
        acceptedTerms: true,
        privacyAcknowledged: true,
        marketingConsent: true,
      },
    );
  });

  it('rejects client-supplied consent version and timestamp fields without invoking connectors', async () => {
    const data = {
      email: 'person@example.com',
      phone: '+48123456789',
      acceptedTerms: true,
      privacyAcknowledged: true,
      'consent.termsVersion': 'client-value',
      'consent.termsAcceptedAt': 'client-value',
    };

    await expect(
      workflow.evaluate({ currentStep: 'collect_contact', submittedData: data, onboardingContext: {} }),
    ).resolves.toEqual({
      kind: 'rejected',
      appliedStep: 'collect_contact',
      status: 'awaiting_user',
      currentStep: 'collect_contact',
      terminal: false,
      fieldErrors: [
        { field: 'consent.termsVersion', code: 'UNDECLARED_FIELD' },
        { field: 'consent.termsAcceptedAt', code: 'UNDECLARED_FIELD' },
      ],
      problem: {
        type: '/problems/invalid-step-data',
        title: 'Invalid step data',
        status: 400,
        code: 'INVALID_STEP_DATA',
        fieldErrors: [
          { field: 'consent.termsVersion', code: 'UNDECLARED_FIELD' },
          { field: 'consent.termsAcceptedAt', code: 'UNDECLARED_FIELD' },
        ],
      },
    });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('returns an invalid format error for phone validation failures', async () => {
    await expect(
      workflow.evaluate({
        currentStep: 'collect_contact',
        submittedData: {
          email: 'person@example.com',
          phone: '123',
          acceptedTerms: true,
          privacyAcknowledged: true,
        },
        onboardingContext: {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'rejected',
        fieldErrors: [{ field: 'phone', code: 'INVALID_FORMAT' }],
      }),
    );
  });

  it('returns required-field errors when required inputs are missing', async () => {
    await expect(
      workflow.evaluate({
        currentStep: 'collect_contact',
        submittedData: { email: 'person@example.com' },
        onboardingContext: {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'rejected',
        fieldErrors: expect.arrayContaining([
          { field: 'phone', code: 'REQUIRED' },
          { field: 'acceptedTerms', code: 'REQUIRED' },
          { field: 'privacyAcknowledged', code: 'REQUIRED' },
        ]),
      }),
    );
  });

  it('attributes false consent to the exact consent field', async () => {
    await expect(
      workflow.evaluate({
        currentStep: 'collect_contact',
        submittedData: {
          email: 'person@example.com',
          phone: '+48123456789',
          acceptedTerms: false,
          privacyAcknowledged: true,
        },
        onboardingContext: {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'rejected',
        fieldErrors: [{ field: 'acceptedTerms', code: 'MUST_BE_TRUE' }],
      }),
    );
  });

  it.each([
    ['terminal step', 'approved', {}],
    ['malformed body', 'collect_contact', null],
    ['array body', 'collect_contact', []],
  ])('returns undefined for %s runtime input', async (_description, currentStep, submittedData) => {
    await expect(
      workflow.evaluate({ currentStep, submittedData, onboardingContext: {} }),
    ).resolves.toBeUndefined();
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('rejects an unknown server-held current step without mutating the body', async () => {
    const data = {
      email: 'person@example.com',
      phone: '+48123456789',
      acceptedTerms: true,
      privacyAcknowledged: true,
    };

    await expect(
      workflow.evaluate({ currentStep: 'missing-step', submittedData: data, onboardingContext: {} }),
    ).resolves.toBeUndefined();
    expect(data).toEqual({
      email: 'person@example.com',
      phone: '+48123456789',
      acceptedTerms: true,
      privacyAcknowledged: true,
    });
    expect(connectorExecutionPort.execute).not.toHaveBeenCalled();
  });

  it('awaits connector execution before returning a successful transition', async () => {
    let resolveExecution: (() => void) | undefined;
    const executionPromise = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });
    connectorExecutionPort.execute = jest.fn().mockReturnValue(executionPromise);
    workflow = new Workflow(definition, connectorExecutionPort);

    let settled = false;
    const evaluationPromise = workflow
      .evaluate({
        currentStep: 'collect_contact',
        submittedData: {
          email: 'person@example.com',
          phone: '+48123456789',
          acceptedTerms: true,
          privacyAcknowledged: true,
        },
        onboardingContext: {},
      })
      .then((value) => {
        settled = true;
        return value;
      });

    await Promise.resolve();
    expect(connectorExecutionPort.execute).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveExecution?.();
    await expect(evaluationPromise).resolves.toMatchObject({
      kind: 'accepted',
      appliedStep: 'collect_contact',
      status: 'approved',
      currentStep: null,
      terminal: true,
    });
  });
});
