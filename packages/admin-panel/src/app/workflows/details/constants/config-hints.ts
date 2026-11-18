import { STEP_TYPE } from '@tsh/ddl-schema/step-types';

/** The object a member belongs to: a step's config, a connector declaration or binding, or a field descriptor. */
export type HintOwner = 'config' | 'connector' | 'field';

/** Applies on every step type. */
const ANY_STEP_TYPE = '*';

type MemberHints = Readonly<Record<string, string>>;

const CANONICAL_HINT = 'Marks fields as email, phone, name; later steps reuse them.';
const DEFAULT_PORT_HINT = 'Adds a default port for when no branch matches.';

/** Help under a member's label, keyed by owner, then step type (or `*`), then member key. */
const CONFIG_HINTS: Readonly<Record<HintOwner, Readonly<Record<string, MemberHints>>>> = {
  config: {
    [STEP_TYPE.form]: {
      canonical: CANONICAL_HINT,
    },
    [STEP_TYPE.connectorCall]: {
      canonical: CANONICAL_HINT,
    },
    [STEP_TYPE.decision]: {
      fallback: DEFAULT_PORT_HINT,
    },
    [STEP_TYPE.riskScore]: {
      fallback: 'Adds a default port for scores outside every band.',
    },
    [STEP_TYPE.kycIdentityVerification]: {
      sourceKey: 'Names the provider setup; no other workflow may share it.',
    },
    [STEP_TYPE.otpVerify]: {
      recipientField: 'Field with the phone or email; empty uses the collected one.',
      resendReasons: 'Provider errors that let the applicant ask for a new code.',
    },
    [STEP_TYPE.notify]: {
      recipientField: 'Field with the address to send the message to.',
    },
    [STEP_TYPE.address]: {
      prefix: "Marks a second address; it won't count as the main one.",
    },
    [STEP_TYPE.consents]: {
      acknowledgement: 'Accepted for terms, acknowledged for notices, consent for marketing.',
    },
    [STEP_TYPE.httpCall]: {
      request:
        'Values can use {{payload.key}}, {{secrets.alias.key}}, {{execution.onboardingId}}, {{execution.stepName}}; names cannot.',
      errorsPath: 'Where the response lists field errors; by default, errors.',
      fieldMapping: 'Only to fill a placeholder from another field: placeholder → field.',
    },
  },
  connector: {
    [ANY_STEP_TYPE]: {
      fallback: 'Backup providers of the same type, tried in order.',
      errorHandler: 'What to do when the call fails; empty falls back.',
      fieldMapping: 'Fields sent to the provider, as provider name → field.',
      optionalFieldMapping: 'Fields sent only when they have a value.',
      order: 'The order connectors run in; unique within the step.',
    },
  },
  field: {
    [ANY_STEP_TYPE]: {
      when: 'Asks for the field only when this holds; otherwise it must be left out.',
      persist: 'When off, checked and passed on but never stored; for codes and secrets.',
    },
  },
};

/** Labels `humanize` gets wrong; every other member keeps its humanized key. */
const CONFIG_LABELS: MemberHints = {
  url: 'URL',
  timeoutMs: 'Timeout (ms)',
};

function readOwn<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The hint for a member, the step type's own before the one for every type; `undefined` when it has none. */
export function findConfigHint(
  owner: HintOwner,
  stepType: string | null,
  key: string,
): string | undefined {
  const byType = CONFIG_HINTS[owner];
  const own = stepType === null ? undefined : readOwn(readOwn(byType, stepType), key);
  return own ?? readOwn(readOwn(byType, ANY_STEP_TYPE), key);
}

/** A member's label where its humanized key reads wrong, or `undefined`. */
export function findConfigLabel(key: string): string | undefined {
  return readOwn(CONFIG_LABELS, key);
}
