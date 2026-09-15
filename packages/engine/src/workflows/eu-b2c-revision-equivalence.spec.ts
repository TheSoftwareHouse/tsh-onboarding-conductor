import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type { NormalizedWorkflowDefinition } from '@tsh/ddl-schema';
import { BUILT_IN_WORKFLOWS_DIR } from './workflow-roots';

const loadRevision = (fileName: string): NormalizedWorkflowDefinition =>
  validateAndNormalizeWorkflow(
    JSON.parse(readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8')),
  );

const CUSTOM_STEP_FILE = 'eu-b2c-individual-kyc-eea.workflow.json';
const SPECIALIZED_FILE = 'eu-b2c-individual-kyc-eea-v2.workflow.json';

/**
 * Revision 1 of the combined route is written step by step, as `custom` steps carrying each
 * step verbatim; revision 2 is the same flow as a graph of specialized steps, with one deliberate
 * change: collecting the applicant's contact details and proving the phone number are two steps,
 * so the one-time code is sent by its own step rather than by the submit that collected the number.
 * This spec pins exactly that — everything else normalizes to the identical definition — so it is
 * both the statement of what changed and the regression test for every step type the graph uses.
 */
describe('the combined route, authored twice', () => {
  const handWritten = loadRevision(CUSTOM_STEP_FILE);
  const specialized = loadRevision(SPECIALIZED_FILE);
  const handWrittenNames = handWritten.steps.map((step) => step.name);

  it('publishes both revisions of one workflow', () => {
    expect([handWritten.id, specialized.id]).toEqual([
      'eu-b2c-individual-kyc-eea',
      'eu-b2c-individual-kyc-eea',
    ]);
    expect([handWritten.version, specialized.version]).toEqual([1, 2]);
  });

  it('adds exactly one step — the code send — and keeps every other step name a client renders against', () => {
    expect(specialized.steps.map((step) => step.name)).toEqual([
      'collect_contact',
      'send_phone_code',
      ...handWrittenNames.slice(1),
    ]);
    expect(specialized.initial).toBe(handWritten.initial);
    expect(specialized.webhook).toEqual(handWritten.webhook);
    expect(specialized.scores).toEqual(handWritten.scores);
  });

  it('collects the same contact details and consents, and no longer sends the code from that step', () => {
    const before = handWritten.stepsByName.collect_contact;
    const after = specialized.stepsByName.collect_contact;

    expect(after.data).toEqual(before.data);
    expect(after.status).toBe(before.status);
    expect(after.connectors).toEqual([]);
    expect(after.transitions).toEqual([{ status: 'success', target: 'send_phone_code' }]);
  });

  it('declares the same agreement families at its root, bound to the same contact step', () => {
    expect(specialized.agreements).toEqual(handWritten.agreements);
    expect(specialized.agreements.map((agreement) => agreement.step)).toEqual([
      'collect_contact',
      'collect_contact',
    ]);
  });

  it('moves the send, unchanged, to a step of its own that collects nothing', () => {
    const before = handWritten.stepsByName.collect_contact;
    const send = specialized.stepsByName.send_phone_code;

    expect(send.data).toEqual({});
    expect(send.connectors).toEqual(before.connectors);
    expect(send.transitions).toEqual(before.transitions);
  });

  it('is otherwise identical, down to every field, connector and transition', () => {
    for (const name of handWrittenNames.slice(1)) {
      expect(specialized.stepsByName[name]).toEqual(handWritten.stepsByName[name]);
    }
  });

  it('shares the provider source key, which belongs to the workflow rather than the revision', () => {
    // The engine enforces uniqueness per workflow id, not per revision — two revisions of one
    // product must not split its traffic at the provider.
    const sourceKeys = (definition: NormalizedWorkflowDefinition): readonly unknown[] =>
      definition.steps.flatMap((step) =>
        step.connectors.map((connector) => connector.config.sourceKey).filter(Boolean),
      );

    expect(sourceKeys(specialized)).toEqual(sourceKeys(handWritten));
  });

  it('says the same thing in a fraction of the text', () => {
    const lines = (fileName: string): number =>
      readFileSync(resolve(BUILT_IN_WORKFLOWS_DIR, fileName), 'utf8').split('\n').length;

    // Not a style preference: the deleted lines are four repetitions of the EEA country list, a
    // sixteen-entry connector mapping and seven routing conditions written out by hand, each of
    // which had to agree with the others and none of which a reviewer could check by reading one
    // place.
    expect(lines(SPECIALIZED_FILE)).toBeLessThan(lines(CUSTOM_STEP_FILE) / 3);
  });
});
