import { SumsubConfigInvalidError } from './sumsub-config';

/**
 * The customer's captured questionnaire answers, keyed by the same item key the workflow's
 * `questionnairePathMap` uses. A key absent from this record — or explicitly `undefined` — is a
 * conditional item whose condition did not hold, and is left out of the submitted body entirely.
 */
export type SumsubQuestionnaireAnswers = Readonly<Record<string, string | boolean | undefined>>;

/**
 * The `sections`/`items` portion of a Sumsub questionnaire submission
 * (`POST .../questionnaires`). The caller wraps this with the questionnaire definition id.
 */
export type SumsubQuestionnaireBody = {
  sections: Record<string, { items: Record<string, { value: string }> }>;
};

const splitPath = (itemKey: string, path: string): { section: string; item: string } => {
  const separatorIndex = path.indexOf('.');

  if (separatorIndex === -1) {
    throw new SumsubConfigInvalidError(
      `questionnairePathMap.${itemKey}`,
      'must be a "<section>.<item>" path',
    );
  }

  return {
    section: path.slice(0, separatorIndex),
    item: path.slice(separatorIndex + 1),
  };
};

/**
 * Sumsub's completeness check does not count a boolean answered `false` as answered — the value
 * stores and reads back perfectly, and step 5 then returns a `409` that never clears. Every answer
 * therefore crosses this boundary as a string, never as the boolean the rest of the engine may
 * hold it as.
 */
const toAnswerValue = (answer: string | boolean): string =>
  typeof answer === 'boolean' ? (answer ? 'yes' : 'no') : answer;

/**
 * Builds the `sections`/`items` body Sumsub's questionnaire submission expects, from the
 * configured path map and the customer's answers. No section or item name is known to this
 * module — both come entirely from splitting each configured path on its first `.`.
 *
 * An item whose answer is `undefined` is a conditional item whose condition did not hold, and is
 * silently left out of the body — never sent as an empty or false value. Every configured path is
 * still split and validated regardless of whether its answer is present, so a malformed path in
 * the map is refused even when the item it names was never going to be answered.
 */
export function buildSumsubQuestionnaireBody(
  pathMap: Readonly<Record<string, string>>,
  answers: SumsubQuestionnaireAnswers,
): SumsubQuestionnaireBody {
  const sections: Record<string, { items: Record<string, { value: string }> }> = {};

  for (const [itemKey, path] of Object.entries(pathMap)) {
    const { section, item } = splitPath(itemKey, path);
    const answer = answers[itemKey];

    if (answer === undefined) {
      continue;
    }

    sections[section] ??= { items: {} };
    sections[section].items[item] = { value: toAnswerValue(answer) };
  }

  return { sections };
}
