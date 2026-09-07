import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import { BUILT_IN_WORKFLOWS_DIR } from './workflow-roots';

const loadRevision = (fileName: string): NormalizedWorkflowDefinition =>
  validateAndNormalizeWorkflow(
    JSON.parse(readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8')),
  );

const HAND_WRITTEN_FILE = 'eu-b2c-individual-kyc-eea.workflow.json';
const NODE_GRAPH_FILE = 'eu-b2c-individual-kyc-eea-v2.workflow.json';

/**
 * Revision 2 of the combined route is the same flow authored as a node graph. This spec is the
 * claim that "the same flow" is literal rather than approximate: both revisions normalize to the
 * identical definition, so nothing about a customer's journey, the data collected, the connectors
 * called or the routing differs between the two authored forms.
 *
 * It is also the regression test for the whole node layer. Every node type revision 2 uses is
 * pinned by it: change how one of them compiles and this fails, naming the difference.
 */
describe('the combined route, authored twice', () => {
  const handWritten = loadRevision(HAND_WRITTEN_FILE);
  const nodeGraph = loadRevision(NODE_GRAPH_FILE);

  /** Everything but the two members a new revision is *expected* to change. */
  const comparable = (
    definition: NormalizedWorkflowDefinition,
  ): Omit<NormalizedWorkflowDefinition, 'name' | 'version'> => ({
    id: definition.id,
    initial: definition.initial,
    webhook: definition.webhook,
    steps: definition.steps,
    stepsByName: definition.stepsByName,
    scores: definition.scores,
  });

  it('publishes both revisions of one workflow', () => {
    expect([handWritten.id, nodeGraph.id]).toEqual([
      'eu-b2c-individual-kyc-eea',
      'eu-b2c-individual-kyc-eea',
    ]);
    expect([handWritten.version, nodeGraph.version]).toEqual([1, 2]);
  });

  it('normalizes to the identical definition, down to every field and transition', () => {
    expect(comparable(nodeGraph)).toEqual(comparable(handWritten));
  });

  it('keeps the step names a client renders against, so no caller has to change', () => {
    expect(nodeGraph.steps.map((step) => step.name)).toEqual(
      handWritten.steps.map((step) => step.name),
    );
    expect(nodeGraph.initial).toBe(handWritten.initial);
  });

  it('shares the provider source key, which belongs to the workflow rather than the revision', () => {
    // The engine enforces uniqueness per workflow id, not per revision — two revisions of one
    // product must not split its traffic at the provider.
    const sourceKeys = (definition: NormalizedWorkflowDefinition): readonly unknown[] =>
      definition.steps.flatMap((step) =>
        step.connectors.map((connector) => connector.config.sourceKey).filter(Boolean),
      );

    expect(sourceKeys(nodeGraph)).toEqual(sourceKeys(handWritten));
  });

  it('says the same thing in a fifth of the text', () => {
    const lines = (fileName: string): number =>
      readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8').split('\n').length;

    // Not a style preference: the deleted lines are four repetitions of the EEA country list, a
    // sixteen-entry connector mapping and seven hand-written routing conditions, each of which had
    // to agree with the others and none of which a reviewer could check by reading one place.
    expect(lines(NODE_GRAPH_FILE)).toBeLessThan(lines(HAND_WRITTEN_FILE) / 4);
  });
});
