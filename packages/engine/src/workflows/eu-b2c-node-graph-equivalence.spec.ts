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
 * Revision 2 of the combined route is the same flow authored as a node graph, with one deliberate
 * change: collecting the applicant's contact details and proving the phone number are two nodes,
 * so the one-time code is sent by its own step rather than by the submit that collected the number.
 * This spec pins exactly that — everything else normalizes to the identical definition — so it is
 * both the statement of what changed and the regression test for every node type the graph uses.
 */
describe('the combined route, authored twice', () => {
  const handWritten = loadRevision(HAND_WRITTEN_FILE);
  const nodeGraph = loadRevision(NODE_GRAPH_FILE);
  const handWrittenNames = handWritten.steps.map((step) => step.name);

  it('publishes both revisions of one workflow', () => {
    expect([handWritten.id, nodeGraph.id]).toEqual([
      'eu-b2c-individual-kyc-eea',
      'eu-b2c-individual-kyc-eea',
    ]);
    expect([handWritten.version, nodeGraph.version]).toEqual([1, 2]);
  });

  it('adds exactly one step — the code send — and keeps every other step name a client renders against', () => {
    expect(nodeGraph.steps.map((step) => step.name)).toEqual([
      'collect_contact',
      'send_phone_code',
      ...handWrittenNames.slice(1),
    ]);
    expect(nodeGraph.initial).toBe(handWritten.initial);
    expect(nodeGraph.webhook).toEqual(handWritten.webhook);
    expect(nodeGraph.scores).toEqual(handWritten.scores);
  });

  it('collects the same contact details and consents, and no longer sends the code from that step', () => {
    const before = handWritten.stepsByName.collect_contact;
    const after = nodeGraph.stepsByName.collect_contact;

    expect(after.data).toEqual(before.data);
    expect(after.status).toBe(before.status);
    expect(after.connectors).toEqual([]);
    expect(after.transitions).toEqual([{ status: 'success', target: 'send_phone_code' }]);
  });

  it('moves the send, unchanged, to a step of its own that collects nothing', () => {
    const before = handWritten.stepsByName.collect_contact;
    const send = nodeGraph.stepsByName.send_phone_code;

    expect(send.data).toEqual({});
    expect(send.connectors).toEqual(before.connectors);
    expect(send.transitions).toEqual(before.transitions);
  });

  it('is otherwise identical, down to every field, connector and transition', () => {
    for (const name of handWrittenNames.slice(1)) {
      expect(nodeGraph.stepsByName[name]).toEqual(handWritten.stepsByName[name]);
    }
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

  it('says the same thing in a fraction of the text', () => {
    const lines = (fileName: string): number =>
      readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8').split('\n').length;

    // Not a style preference: the deleted lines are four repetitions of the EEA country list, a
    // sixteen-entry connector mapping and seven hand-written routing conditions, each of which had
    // to agree with the others and none of which a reviewer could check by reading one place.
    expect(lines(NODE_GRAPH_FILE)).toBeLessThan(lines(HAND_WRITTEN_FILE) / 3);
  });
});
