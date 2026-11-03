import {
  BUILT_IN_PASS_FIELDS,
  DATE_OF_BIRTH_NAME_PATTERN,
  DescriptorType,
  FieldClass,
  PseudonymFormat,
} from './masking.constants';
import type {
  ClassifiableWorkflowDocument,
  FieldClassification,
  FieldClassMap,
  FieldShape,
} from './masking.types';

const PASS: FieldClassification = { class: FieldClass.PASS };
const DROP: FieldClassification = { class: FieldClass.DROP };
const GENERALISE: FieldClassification = { class: FieldClass.GENERALISE };

/** How much a class gives up, so two declarations of one name resolve to the stricter one. */
const RESTRICTIVENESS: Record<FieldClass, number> = {
  [FieldClass.PASS]: 0,
  [FieldClass.PSEUDONYMISE]: 1,
  [FieldClass.GENERALISE]: 2,
  [FieldClass.DROP]: 3,
};

/** Splits the `MCP_MASKING_PASS_FIELDS` value into field names. */
export function parsePassFields(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Combines the field classes of several workflow versions into one. A name declared twice takes
 * the stricter class, and two different pseudonym formats cannot both hold, so it is dropped.
 */
export function mergeFieldClassMaps(maps: readonly FieldClassMap[]): FieldClassMap {
  const merged = new Map<string, FieldClassification>();

  for (const map of maps) {
    for (const [name, incoming] of map) {
      const existing = merged.get(name);
      merged.set(name, existing ? pickStricter(existing, incoming) : incoming);
    }
  }

  return merged;
}

export function pickStricter(
  left: FieldClassification,
  right: FieldClassification,
): FieldClassification {
  const difference = RESTRICTIVENESS[left.class] - RESTRICTIVENESS[right.class];

  if (difference !== 0) {
    return difference > 0 ? left : right;
  }

  if (
    left.class === FieldClass.PSEUDONYMISE &&
    right.class === FieldClass.PSEUDONYMISE &&
    left.format !== right.format
  ) {
    return DROP;
  }

  return left;
}

/**
 * Decides, from the declarations in a compiled workflow document, how each collected field is
 * masked. Default deny: a field is `pass` only when its declaration proves it carries no applicant
 * text — a boolean, an enumeration, or a name the operator listed — and every other free-form
 * value is dropped.
 */
export class FieldClassifier {
  private readonly passFields: ReadonlySet<string>;

  constructor(configuredPassFields: Iterable<string> = []) {
    this.passFields = new Set([...BUILT_IN_PASS_FIELDS, ...configuredPassFields]);
  }

  classify(document: ClassifiableWorkflowDocument): FieldClassMap {
    const classes = new Map<string, FieldClassification>();

    for (const step of document.steps) {
      for (const [name, shape] of Object.entries(step.data ?? {})) {
        const incoming = this.classifyField(name, shape);
        const existing = classes.get(name);
        classes.set(name, existing ? pickStricter(existing, incoming) : incoming);
      }
    }

    return classes;
  }

  private classifyField(name: string, shape: FieldShape): FieldClassification {
    if (shape.type === DescriptorType.FILE || shape.type === DescriptorType.OBJECT) {
      return DROP;
    }

    if (this.passFields.has(name)) {
      return PASS;
    }

    switch (shape.type) {
      case DescriptorType.BOOLEAN:
        return PASS;
      case DescriptorType.TEXT:
      case DescriptorType.STRING:
        return this.classifyText(shape);
      case DescriptorType.DATE:
        return this.classifyDate(name, shape);
      case DescriptorType.ARRAY:
        return shape.items && this.classifyField(name, shape.items).class === FieldClass.PASS
          ? PASS
          : DROP;
      default:
        return DROP;
    }
  }

  private classifyText(shape: FieldShape): FieldClassification {
    const validation = shape.validation ?? {};

    // The compiled document names the same two formats the pseudonym prefixes use.
    if (
      validation.format === PseudonymFormat.EMAIL ||
      validation.format === PseudonymFormat.PHONE
    ) {
      return { class: FieldClass.PSEUDONYMISE, format: validation.format };
    }

    return Array.isArray(validation.oneOf) || Array.isArray(validation.manyOf) ? PASS : DROP;
  }

  private classifyDate(name: string, shape: FieldShape): FieldClassification {
    const validation = shape.validation ?? {};
    const hasAgeBound =
      typeof validation.minAgeYears === 'number' || typeof validation.maxAgeYears === 'number';

    return hasAgeBound || DATE_OF_BIRTH_NAME_PATTERN.test(name) ? GENERALISE : DROP;
  }
}
