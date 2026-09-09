import type { RawWorkflowCondition } from '../workflow-condition';
import type {
  RawWorkflowRootWebhookDeclaration,
  RawWorkflowScoreDeclaration,
} from '../workflow-contract';

/**
 * A field fragment merged into the including node's entry step. Only a node type marked
 * `composable` may appear here.
 */
export type RawWorkflowNodeInclude = {
  type: string;
  config?: Record<string, unknown>;
};

/**
 * One arm of a conditional edge. Arms are tried in order; an arm with no `when` is the fallback and
 * must come last, mirroring the rule the step form applies to a status group.
 */
export type RawWorkflowNodeEdgeArm = {
  when?: RawWorkflowCondition;
  target: string;
};

/**
 * Where a port leads: a node name, or arms that pick the node by condition. The conditional form is
 * what lets a canvas draw a fork out of one outcome without an author reaching for a `decision`
 * node — and its extra round trip — to split it.
 */
export type RawWorkflowNodeEdge = string | RawWorkflowNodeEdgeArm[];

/**
 * Free-form authoring metadata — a title, a description, a canvas position. The compiler never
 * reads it; it is carried so a builder has somewhere to keep what it needs, since the stored
 * document is the authored one and there is no other place to keep layout.
 */
export type RawWorkflowNodeMeta = Record<string, unknown>;

export type RawWorkflowNode = {
  name: string;
  /** The node type this node instantiates, matched against `WorkflowNodeTypeDefinition.type`. */
  type: string;
  config?: Record<string, unknown>;
  /**
   * Fragments whose fields join this node's entry step, after the node type's own fields and in
   * declared order. This is how one screen collects an identity, an address and a bespoke field
   * without three round trips.
   */
  include?: RawWorkflowNodeInclude[];
  /**
   * Renames a generated sub-step, keyed by the sub-step key its node type declares. Step names are
   * client-visible — a client renders per step — so a document migrating from hand-written steps
   * keeps its names rather than forcing every caller to change.
   */
  steps?: Record<string, string>;
  /** Where each output port leads. */
  edges?: Record<string, RawWorkflowNodeEdge>;
  meta?: RawWorkflowNodeMeta;
};

/**
 * The authored form of a workflow: a graph of typed nodes rather than a list of steps. Compiled to
 * the step form by `compileNodeGraph` before anything else validates it, so the two forms cannot
 * diverge in meaning and the engine only ever sees steps.
 */
export type RawWorkflowNodeGraphDefinition = {
  id: string;
  version: number;
  name: string;
  /** The node the onboarding starts on. Defaults to the first node. */
  initial?: string;
  webhook?: RawWorkflowRootWebhookDeclaration;
  scoring?: Record<string, RawWorkflowScoreDeclaration>;
  meta?: RawWorkflowNodeMeta;
  nodes: RawWorkflowNode[];
};

/**
 * Which form a document is in. `nodes` and `steps` are mutually exclusive: the step schema forbids
 * unknown properties, so a document carrying both would fail there anyway — refusing it here names
 * the mistake instead.
 */
export const isNodeGraphDefinition = (input: unknown): boolean => {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.prototype.hasOwnProperty.call(input, 'nodes')
  );
};
