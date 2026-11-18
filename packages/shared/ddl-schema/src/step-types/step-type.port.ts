import type { JsonSchemaFragment } from '../fields/field-type.port';
import type { RawWorkflowCondition } from '../workflow-condition';
import type {
  ArrayValidation,
  BooleanValidation,
  DateValidation,
  FileValidation,
  NumberValidation,
  RawWorkflowField,
  CompiledWorkflowStep,
  TextValidation,
} from '../workflow-contract';
import type { WorkflowInvalidPath, WorkflowInvalidReason } from '../workflow-invalid.error';
import type { RawWorkflowStepInclude } from '../workflow-contract';
import type { StepConnectorSlot } from './step-config.utils';

export type FailWorkflow = (reason: WorkflowInvalidReason, path?: WorkflowInvalidPath) => never;

// Re-exported so a step type module has one import for everything it needs to emit a descriptor.
export type {
  ArrayValidation,
  BooleanValidation,
  DateValidation,
  FileValidation,
  NumberValidation,
  TextValidation,
} from '../workflow-contract';
export type { JsonSchemaFragment } from '../fields/field-type.port';

export const COLLECT_STEP_CATEGORY = 'collect';

/**
 * What a step does, from the operator's point of view. It groups the palette a builder renders and
 * nothing else — the compiler never branches on it, so a category is free to hold one step type or
 * a dozen.
 */
export const STEP_CATEGORIES = [
  COLLECT_STEP_CATEGORY,
  'verify',
  'decide',
  'integrate',
  'terminal',
] as const;

export type WorkflowStepCategory = (typeof STEP_CATEGORIES)[number];

/**
 * One named outcome an author connects an edge to. Ports are the whole reason step types exist as
 * a layer: `submit_kyc`'s seven `when`-qualified transition arms are seven ports, and an author
 * draws arrows instead of writing the conditions that distinguish them.
 */
export type WorkflowStepPort = {
  readonly name: string;
  /** An unwired required port fails the document at load; an optional one simply has no arm. */
  readonly optional?: boolean;
};

/** The common envelope, plus the members the field type that owns them reads. */
type StepFieldEnvelope = {
  required: boolean;
  persist?: boolean;
  when?: RawWorkflowCondition;
};

export type StepTextField = StepFieldEnvelope & { type: 'text'; validation?: TextValidation };
export type StepNumberField = StepFieldEnvelope & { type: 'number'; validation?: NumberValidation };
export type StepBooleanField = StepFieldEnvelope & {
  type: 'boolean';
  validation?: BooleanValidation;
};
export type StepDateField = StepFieldEnvelope & { type: 'date'; validation?: DateValidation };
export type StepFileField = StepFieldEnvelope & { type: 'file'; validation: FileValidation };
export type StepArrayField = StepFieldEnvelope & {
  type: 'array';
  items: { type: string };
  validation?: ArrayValidation;
};

/**
 * A descriptor an author wrote by hand, in `form`'s or `custom`'s config. Left open because
 * it is a genuinely dynamic boundary: the field normalizer is the authority on what a descriptor
 * may carry, and duplicating its rules here would only let the two disagree.
 */
export type AuthoredFieldDescriptor = RawWorkflowField & { readonly [member: string]: unknown };

export type StepFieldDescriptor =
  | StepTextField
  | StepNumberField
  | StepBooleanField
  | StepDateField
  | StepFileField
  | StepArrayField
  | AuthoredFieldDescriptor;

export type StepFieldMap = Record<string, StepFieldDescriptor>;

/**
 * The roles a step may claim for one of its fields, so a downstream step can find the value
 * without the author restating a mapping. `kyc-identity-verification` builds its whole
 * `fieldMapping` from these, which is what turns 209 lines of connector declaration into five of
 * config.
 *
 * Deliberately a closed list of the attributes a financial onboarding always means the same thing
 * by. Anything provider- or workflow-specific stays an explicit mapping.
 */
export const CANONICAL_FIELD_ROLES = [
  'email',
  'phoneNumber',
  'firstName',
  'middleNames',
  'lastName',
  'dateOfBirth',
  'nationality',
  'street',
  'street2',
  'town',
  'region',
  'postCode',
  'country',
] as const;

export type CanonicalFieldRole = (typeof CANONICAL_FIELD_ROLES)[number];

export type CanonicalFieldMap = Partial<Record<CanonicalFieldRole, string>>;

/** The slot a captured document fills. Named by purpose, not by any one provider's vocabulary. */
export const DOCUMENT_SET_TYPES = ['IDENTITY', 'SELFIE', 'PROOF_OF_ADDRESS'] as const;

export type DocumentSetType = (typeof DOCUMENT_SET_TYPES)[number];

export const DOCUMENT_SIDES = ['FRONT_SIDE', 'BACK_SIDE'] as const;

export type DocumentSide = (typeof DOCUMENT_SIDES)[number];

/** One upload a capture step collects. */
export type PublishedDocument = {
  readonly field: string;
  readonly docSetType: DocumentSetType;
  readonly docType: string;
  /** Absent for a single-sided document. */
  readonly side?: DocumentSide;
};

/**
 * One document a choice step offers. `optional` is true whenever the applicant may present
 * something else instead, because then the capture fields behind it are absent on every other
 * branch — which is exactly what a connector's `optionalFieldMapping` declares.
 */
export type PublishedDocumentOption = {
  readonly docType: string;
  readonly issuingCountryField: string;
  readonly optional: boolean;
};

/** One questionnaire answer, and the `<section>.<item>` path a provider stores it at. */
export type PublishedQuestionnaireItem = {
  readonly field: string;
  readonly path: string;
};

/** What one step contributes to the document-wide contract. */
export type StepPublication = {
  readonly canonicalFields?: CanonicalFieldMap;
  readonly documents?: readonly PublishedDocument[];
  readonly documentOptions?: readonly PublishedDocumentOption[];
  readonly questionnaireItems?: readonly PublishedQuestionnaireItem[];
};

/**
 * Every publication in the document, assembled once before any step compiles and handed to all of
 * them. The two-phase compile is what lets a step read what its neighbours collect without the
 * author wiring them together by hand.
 */
export type WorkflowStepContract = {
  readonly canonicalFields: Readonly<CanonicalFieldMap>;
  readonly documents: readonly PublishedDocument[];
  readonly documentOptions: readonly PublishedDocumentOption[];
  readonly questionnaireItems: readonly PublishedQuestionnaireItem[];
};

export type WorkflowStepCompilationContext<TConfig = unknown> = {
  /** The step's authored name. */
  readonly name: string;
  readonly config: TConfig;
  /**
   * Step names this step owns, in the order `listSubStepKeys` declared them. `[0]` is the entry
   * step, the one every inbound edge resolves to.
   */
  readonly stepNames: readonly string[];
  /** The entry step's data: this step type's own fields first, then each `include`'s, in order. */
  readonly fields: StepFieldMap;
  /**
   * What to write as a transition's `target` to follow a port, per port; `undefined` for an
   * unwired optional port. Opaque on purpose: the compiler substitutes the real step name — or, for
   * a conditional edge, fans the transition out into one arm per condition — after the step has
   * compiled, so a step type never learns where its ports lead and never has to.
   */
  readonly targets: Readonly<Record<string, string | undefined>>;
  /**
   * What the steps that can precede this one collect. Scoped to ancestors rather than the whole
   * document, so a step placed after this one cannot leak a field into its connector mapping that
   * will never have been collected when the mapping is read.
   */
  readonly contract: WorkflowStepContract;
  readonly fail: FailWorkflow;
};

/**
 * Everything the package knows about one step type. Adding a type means adding one module that
 * implements this port plus one entry in `step-type.registry.ts` — the same seam field types use.
 *
 * A step type compiles to ordinary compiled steps and nothing else: the runtime still sees the
 * single homogeneous step shape `docs/IMPLEMENTATION.md` §1 commits to, and step types are an
 * authoring concern the engine never learns about.
 */
export interface WorkflowStepTypeDefinition<TConfig = unknown> {
  /** Canonical type name, as a step's `type` names it. */
  readonly type: string;
  readonly category: WorkflowStepCategory;
  /**
   * True when this type may also appear in another step's `include` list. Requires that it compile
   * to exactly one step, declare no connectors and expose no ports — a fragment contributes
   * fields, never control flow.
   */
  readonly composable?: boolean;
  /**
   * The connector slot this type fills, when it calls a connector at all: which capabilities may
   * fill it and what the author may add. Published to a builder so it offers only matching
   * connectors.
   */
  readonly connectorSlot?: StepConnectorSlot;
  /** JSON Schema for this type's `config`, composed into the workflow schema and served to a builder. */
  buildConfigSchema(): JsonSchemaFragment;
  parseConfig(config: Record<string, unknown> | undefined, fail: FailWorkflow): TConfig;
  listPorts(config: TConfig): readonly WorkflowStepPort[];
  /**
   * The sub-steps this step compiles to. `null` means the step's own name, unsuffixed; a string
   * key becomes `<step>_<key>` unless the step renames it through `substeps`. The first entry is
   * the step's entry step.
   */
  listSubStepKeys(config: TConfig): readonly (string | null)[];
  /** Fields this step contributes to its own entry step. */
  buildFields(config: TConfig): StepFieldMap;
  /**
   * Which of this step's compiled steps carries the rules an author writes under its own `scoring`,
   * as a key from `listSubStepKeys`: the step whose submit decides the step's outcome. Left out,
   * the entry step. A type with no submit to score on — `terminal` — or one that carries its rules
   * in config — `risk-score` — returns `undefined`, and a step of it declaring `scoring` fails at
   * `steps[i].scoring` rather than compiling rules nothing would ever evaluate.
   */
  resolveScoringStepKey?(config: TConfig): string | null | undefined;
  publish?(config: TConfig): StepPublication;
  compile(context: WorkflowStepCompilationContext<TConfig>): CompiledWorkflowStep[];
}

/** A resolved `include` entry: the fragment's definition and its parsed config. */
export type ResolvedStepInclude = {
  readonly definition: WorkflowStepTypeDefinition;
  readonly include: RawWorkflowStepInclude;
  readonly config: unknown;
};
