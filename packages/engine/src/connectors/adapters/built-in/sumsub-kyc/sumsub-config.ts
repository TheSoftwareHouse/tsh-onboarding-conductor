import type { ConnectorSettingsSchema } from '../../../ports/connector-adapter.port';
import {
  KycConfigInvalidError,
  parseKycConfig,
  type KycConfig,
  type KycDocumentMapping,
} from '../kyc/kyc-config';
import { SUMSUB_KYC_CONNECTOR_ID } from './sumsub-contract';

/**
 * All three are operator-provided connector settings configured through the admin API
 * (`PUT /v1/admin/connectors/sumsub_kyc`), not environment variables — the `connectors` table is
 * the only source, and all are editable at runtime.
 *
 * `appToken` and `secretKey` sign the calls the adapter makes to Sumsub;
 * `callbackSigningSecret` is the one Sumsub signs its callbacks to us with, and
 * `CallbackSignatureVerifier` reads it from here rather than from the environment
 * (`docs/decisions/0006-callback-signing-secret-in-connector-settings.md`). A rotation window is a
 * comma-separated list of secrets, every one of which the verifier accepts; a secret containing a
 * comma therefore cannot be stored.
 */
export const SUMSUB_KYC_SETTINGS_SCHEMA: ConnectorSettingsSchema = {
  fields: [
    { key: 'appToken', secret: false, required: true },
    { key: 'secretKey', secret: true, required: true },
    { key: 'callbackSigningSecret', secret: true, required: true },
  ],
};

/**
 * The keys of a `sumsub_kyc` declaration's `config` that only Sumsub reads. They reach the
 * provider as `providerConfig`, wherever they were authored (step level or `connector.config`).
 */
export type SumsubProviderConfig = {
  readonly levelName: string;
  readonly questionnaireDefinitionId: string;
};

/**
 * The declaration's `config` as the Sumsub adapter reads it: the kernel's parse plus the Sumsub
 * keys. Unlike the kernel, Sumsub requires a questionnaire — its level cannot be finalised
 * without one.
 */
export type SumsubConfig = SumsubProviderConfig & {
  readonly sourceKey: string;
  readonly documents: readonly KycDocumentMapping[];
  readonly questionnairePathMap: Readonly<Record<string, string>>;
  readonly maxAttemptsPerDocSet: number;
};

/**
 * A malformed `sumsub_kyc` key — a startup-time authoring defect, not a client-facing error, per
 * `packages/engine/CLAUDE.md`'s two-tier error contract.
 */
export class SumsubConfigInvalidError extends KycConfigInvalidError {
  constructor(key: string, reason: string) {
    super(SUMSUB_KYC_CONNECTOR_ID, key, reason);
    this.name = 'SumsubConfigInvalidError';
  }
}

const parseNonEmptyString = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SumsubConfigInvalidError(key, 'must be a non-empty string');
  }

  return value.trim();
};

/** Parses the keys only Sumsub reads. Throws `SumsubConfigInvalidError` naming the offending key. */
export function parseSumsubProviderConfig(
  providerConfig: Readonly<Record<string, unknown>>,
): SumsubProviderConfig {
  return {
    levelName: parseNonEmptyString(providerConfig.levelName, 'levelName'),
    questionnaireDefinitionId: parseNonEmptyString(
      providerConfig.questionnaireDefinitionId,
      'questionnaireDefinitionId',
    ),
  };
}

export function requireQuestionnairePathMap(
  questionnairePathMap: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (questionnairePathMap === undefined) {
    throw new SumsubConfigInvalidError('questionnairePathMap', 'must be a non-empty object');
  }

  return questionnairePathMap;
}

/**
 * Parses a `sumsub_kyc` workflow declaration's `config` into its typed shape: the kernel's
 * `parseKycConfig`, then the Sumsub keys. Throws `KycConfigInvalidError` (or its Sumsub subclass)
 * naming the offending key on any malformed or missing value.
 */
export function parseSumsubConfig(config: Readonly<Record<string, unknown>>): SumsubConfig {
  const { providerConfig, questionnairePathMap, ...kernelConfig }: KycConfig = parseKycConfig(
    SUMSUB_KYC_CONNECTOR_ID,
    config,
  );

  return {
    ...kernelConfig,
    ...parseSumsubProviderConfig(providerConfig),
    questionnairePathMap: requireQuestionnairePathMap(questionnairePathMap),
  };
}
