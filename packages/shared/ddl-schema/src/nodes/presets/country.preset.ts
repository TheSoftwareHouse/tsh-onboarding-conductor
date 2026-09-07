import type { FailWorkflow } from '../node-type.port';

/**
 * The 30 EEA member states, as ISO alpha-2 — what a European onboarding means by "our market".
 * Declared once here rather than inlined per field: the hand-written form of
 * `eu-b2c-individual-kyc-eea` repeated this list four times, 128 of its 906 lines.
 */
export const EEA_MEMBER_STATES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IS',
  'IE',
  'IT',
  'LV',
  'LI',
  'LT',
  'LU',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
] as const;

/**
 * The EEA states that issue a national identity card. Denmark and Ireland do not, so offering the
 * card to their nationals would strand them on a document they cannot produce.
 */
export const EEA_ID_CARD_ISSUERS = EEA_MEMBER_STATES.filter(
  (code) => code !== 'DK' && code !== 'IE',
);

/** Named country lists a node config references instead of spelling the codes out. */
export const COUNTRY_PRESETS = {
  eea: EEA_MEMBER_STATES,
  'eea-id-card-issuers': EEA_ID_CARD_ISSUERS,
} as const satisfies Record<string, readonly string[]>;

export type CountryPresetName = keyof typeof COUNTRY_PRESETS;

export const COUNTRY_PRESET_NAMES = Object.keys(COUNTRY_PRESETS);

const ALPHA_2_PATTERN = /^[A-Z]{2}$/;

/**
 * Resolves a config's country declaration: a preset name, or an explicit alpha-2 list for a market
 * no preset covers.
 */
export const resolveCountryList = (declared: unknown, fail: FailWorkflow): readonly string[] => {
  if (typeof declared === 'string') {
    return COUNTRY_PRESETS[declared as CountryPresetName] ?? fail('INVALID_VALUE');
  }

  if (!Array.isArray(declared) || declared.length === 0) {
    fail('INVALID_VALUE');
  }

  for (const code of declared as readonly unknown[]) {
    if (typeof code !== 'string' || !ALPHA_2_PATTERN.test(code)) {
      fail('INVALID_VALUE');
    }
  }

  return [...(declared as readonly string[])];
};
