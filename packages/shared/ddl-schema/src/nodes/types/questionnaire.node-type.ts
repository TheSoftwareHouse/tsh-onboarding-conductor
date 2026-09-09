import { asConfigObject, readStringList } from '../node-config.utils';
import {
  compileSingleOutcomeStep,
  SINGLE_OUTCOME_PORTS,
  SINGLE_STEP_KEYS,
} from '../node-step.utils';
import type {
  JsonSchemaFragment,
  NodeFieldMap,
  NodePublication,
  PublishedQuestionnaireItem,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';
import {
  buildQuestionnaireField,
  getQuestionnaireSection,
  QUESTIONNAIRE_SECTION_NAMES,
  type QuestionnaireSectionPreset,
} from '../presets/questionnaire.preset';

export type QuestionnaireNodeConfig = {
  readonly sections: readonly QuestionnaireSectionPreset[];
};

/**
 * The risk-profiling questions: what the account is for, how the applicant earns, what they expect
 * to move through it, and whether they are politically exposed. Sections are presets rather than
 * free config because the option sets are the part that must not vary — an occupation list
 * invented per workflow cannot be compared across workflows, and every risk model reading it has
 * to learn the variant.
 *
 * Each item carries the `<section>.<item>` path its answer is stored at, and publishes it, so a
 * `kyc` node derives its whole questionnaire mapping from whatever sections the document asks.
 */
export const questionnaireNodeTypeDefinition = {
  type: 'questionnaire',
  category: 'collect',
  composable: true,
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['sections'],
      properties: {
        sections: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { enum: [...QUESTIONNAIRE_SECTION_NAMES] },
        },
      },
    };
  },
  parseConfig(config, fail): QuestionnaireNodeConfig {
    const source = asConfigObject(config, fail);
    const names = readStringList(source.sections, fail);

    if (new Set(names).size !== names.length) {
      fail('INVALID_VALUE');
    }

    return { sections: names.map((name) => getQuestionnaireSection(name, fail)) };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return SINGLE_OUTCOME_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: QuestionnaireNodeConfig): NodeFieldMap {
    const fields: NodeFieldMap = {};

    for (const section of config.sections) {
      for (const item of section.items) {
        fields[item.field] = buildQuestionnaireField(item);
      }
    }

    return fields;
  },
  publish(config: QuestionnaireNodeConfig): NodePublication {
    const questionnaireItems: PublishedQuestionnaireItem[] = [];

    for (const section of config.sections) {
      for (const item of section.items) {
        questionnaireItems.push({ field: item.field, path: item.path });
      }
    }

    return { questionnaireItems };
  },
  compile: compileSingleOutcomeStep,
} as const satisfies WorkflowNodeTypeDefinition<QuestionnaireNodeConfig>;
