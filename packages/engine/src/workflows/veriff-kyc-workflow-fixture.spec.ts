import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import { parseKycConfig } from '../connectors/adapters/built-in/kyc/kyc-config';
import { Workflow } from './domain/workflow';

const veriffKycWorkflowPath = resolve(
  __dirname,
  '../../../../workflows/fixtures/veriff-kyc.workflow.json',
);
const veriffKycWorkflowConfig = JSON.parse(readFileSync(veriffKycWorkflowPath, 'utf8'));

const CAPTURE_IDENTITY_STEP = 'capture_identity';
const SUBMIT_KYC_STEP = 'submit_kyc';
const VERIFF_KYC_CONNECTOR_ID = 'veriff_kyc';

describe('veriff-kyc.workflow.json', () => {
  const definition = validateAndNormalizeWorkflow(veriffKycWorkflowConfig);

  it('loads and normalizes through the existing registry with no schema change', () => {
    expect(definition.id).toBe('veriff-kyc');
    expect(definition.stepsByName[SUBMIT_KYC_STEP]).toBeDefined();
  });

  it('declares a veriff_kyc connector config that parses clean through parseKycConfig', () => {
    const declaration = definition.stepsByName[SUBMIT_KYC_STEP].connectors.find(
      (connector) => connector.id === VERIFF_KYC_CONNECTOR_ID,
    );

    expect(declaration).toBeDefined();
    expect(declaration?.async).toBe(true);

    const config = parseKycConfig(VERIFF_KYC_CONNECTOR_ID, declaration!.config);

    expect(config.sourceKey).toBe('veriff_kyc_fixture_v1');
    // Veriff has no level and no questionnaire definition: the answers travel as the vendor data.
    expect(Object.keys(config.providerConfig)).toEqual([]);
    expect(Object.keys(config.questionnairePathMap ?? {}).length).toBeGreaterThan(0);
    expect(config.maxAttemptsPerDocSet).toBe(3);

    expect(config.documents).toHaveLength(3);
    const docSetTypes = [...new Set(config.documents.map((document) => document.idDocSetType))];
    expect(docSetTypes).toEqual(['IDENTITY', 'SELFIE']);

    const identityDocuments = config.documents.filter(
      (document) => document.idDocSetType === 'IDENTITY',
    );
    expect(identityDocuments.map((document) => document.idDocSubType)).toEqual([
      'FRONT_SIDE',
      'BACK_SIDE',
    ]);

    const selfieDocument = config.documents.find((document) => document.idDocSetType === 'SELFIE');
    expect(selfieDocument?.idDocType).toBe('SELFIE');
    expect(selfieDocument?.idDocSubType).toBeUndefined();
    // A fixed issuing country is stored as alpha-2, as the fixture authors it.
    expect(config.documents.map((document) => document.country)).toEqual(['PL', 'PL', 'PL']);
  });

  it('collects every questionnairePathMap answer in a guaranteed predecessor step and maps it through fieldMapping', () => {
    const declaration = definition.stepsByName[SUBMIT_KYC_STEP].connectors.find(
      (connector) => connector.id === VERIFF_KYC_CONNECTOR_ID,
    );
    const config = parseKycConfig(VERIFF_KYC_CONNECTOR_ID, declaration!.config);
    const fieldMapping = declaration!.fieldMapping;
    const captureIdentityFields = definition.stepsByName[CAPTURE_IDENTITY_STEP].data;

    for (const itemKey of Object.keys(config.questionnairePathMap ?? {})) {
      const sourceField = fieldMapping[itemKey];
      expect(sourceField).toBeDefined();
      expect(captureIdentityFields[sourceField as string]).toBeDefined();
    }
  });

  it('routes each of the four kycOutcome values to a distinct target', async () => {
    const workflow = new Workflow(definition);

    const outcomes: readonly {
      submittedData: Record<string, string>;
      status: string;
      currentStep: string | null;
    }[] = [
      { submittedData: { kycOutcome: 'verified' }, status: 'approved', currentStep: null },
      {
        submittedData: { kycOutcome: 'human_review' },
        status: 'awaiting_manual_review',
        currentStep: 'manual_review',
      },
      {
        submittedData: { kycOutcome: 'retry', kycRetryStep: 'IDENTITY' },
        status: 'awaiting_user',
        currentStep: 'capture_identity',
      },
      { submittedData: { kycOutcome: 'refused' }, status: 'rejected', currentStep: null },
    ];

    const seenTargets = new Set<string>();

    for (const outcome of outcomes) {
      const result = await workflow.evaluate({
        currentStep: SUBMIT_KYC_STEP,
        submittedData: outcome.submittedData,
        onboardingContext: {},
        onboardingId: 'onboarding-veriff-kyc-test',
        onboardingScores: {},
      });

      expect(result.isAccepted()).toBe(true);
      const nextState = result.getNextState();
      expect(nextState?.status).toBe(outcome.status);
      expect(nextState?.currentStep).toBe(outcome.currentStep);

      const targetKey = `${nextState?.status}:${nextState?.currentStep}`;
      expect(seenTargets.has(targetKey)).toBe(false);
      seenTargets.add(targetKey);
    }

    expect(seenTargets.size).toBe(4);
  });

  it('routes a retry back to the capture step of the docSet named in kycRetryStep', async () => {
    const workflow = new Workflow(definition);

    const identityRetryResult = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'retry', kycRetryStep: 'IDENTITY' },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(identityRetryResult.isAccepted()).toBe(true);
    expect(identityRetryResult.getNextState()?.currentStep).toBe('capture_identity');

    const selfieRetryResult = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'retry', kycRetryStep: 'SELFIE' },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(selfieRetryResult.isAccepted()).toBe(true);
    expect(selfieRetryResult.getNextState()?.currentStep).toBe('capture_selfie');
  });

  it('routes a retry on the APPLICANT_DATA docSet back to capture_identity, not to rejected', async () => {
    const workflow = new Workflow(definition);

    const result = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'retry', kycRetryStep: 'APPLICANT_DATA' },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(result.isAccepted()).toBe(true);
    const nextState = result.getNextState();
    expect(nextState?.status).toBe('awaiting_user');
    expect(nextState?.currentStep).toBe('capture_identity');
  });

  it('routes a retry on the QUESTIONNAIRE docSet back to capture_identity, not to rejected', async () => {
    const workflow = new Workflow(definition);

    const result = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'retry', kycRetryStep: 'QUESTIONNAIRE' },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(result.isAccepted()).toBe(true);
    const nextState = result.getNextState();
    expect(nextState?.status).toBe('awaiting_user');
    expect(nextState?.currentStep).toBe('capture_identity');
  });

  it('declares the five callback fields, kycAttemptCount among them', () => {
    expect(Object.keys(definition.stepsByName[SUBMIT_KYC_STEP].data)).toEqual([
      'kycOutcome',
      'kycRetryStep',
      'kycReasonCodes',
      'kycCustomerMessage',
      'kycAttemptCount',
    ]);
  });

  it('accepts a retry body carrying kycAttemptCount and lands it in the next state context', async () => {
    const workflow = new Workflow(definition);

    const result = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'retry', kycRetryStep: 'IDENTITY', kycAttemptCount: 2 },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(result.isAccepted()).toBe(true);
    const nextState = result.getNextState();
    expect(nextState?.currentStep).toBe('capture_identity');
    expect(nextState?.context).toMatchObject({ kycAttemptCount: 2 });
  });

  it('refuses an undeclared fifth kycOutcome value at the compiled schema', async () => {
    const workflow = new Workflow(definition);

    const result = await workflow.evaluate({
      currentStep: SUBMIT_KYC_STEP,
      submittedData: { kycOutcome: 'escalated' },
      onboardingContext: {},
      onboardingId: 'onboarding-veriff-kyc-test',
      onboardingScores: {},
    });

    expect(result.isRetryableInvalidData()).toBe(true);
    expect(Object.keys(result.getErrors())).toContain('kycOutcome');
  });
});
