import { describe, expect, it } from 'vitest';
import type {
  WorkflowConnectorVersion,
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';
import { describePublishConnectorNotes } from './describe-publish-connector-notes';

function step(name: string, versions: WorkflowConnectorVersion[]): WorkflowStepDefinition {
  return {
    name,
    status: 'awaiting_user',
    terminal: false,
    transitions: [],
    source: null,
    fields: [],
    connectors: [
      {
        id: 'veriff_kyc',
        authoredId: 'veriff_kyc',
        name: 'Veriff',
        type: 'kyc',
        order: 1,
        canReject: true,
        async: true,
        fieldMapping: {},
        optionalFieldMapping: {},
        selected: false,
        selectableIds: [],
        versions,
        fallbacks: [],
      },
    ],
  };
}

function definition(...steps: WorkflowStepDefinition[]): WorkflowDefinition {
  return {
    workflowId: 'kyc',
    workflowVersion: 3,
    name: null,
    initialStep: 'submit_kyc',
    scores: {},
    webhook: null,
    steps,
  };
}

function entry(version: number, id: string, selected: boolean): WorkflowConnectorVersion {
  return { version, id, authoredId: 'veriff_kyc', selected };
}

describe('describePublishConnectorNotes', () => {
  it('says nothing when every selected id matches the authored one', () => {
    const notes = describePublishConnectorNotes(
      definition(step('submit_kyc', [entry(1, 'veriff_kyc', true)])),
    );
    expect(notes).toEqual([]);
  });

  it('says nothing when nothing is selected', () => {
    const notes = describePublishConnectorNotes(
      definition(
        step('submit_kyc', [entry(1, 'sumsub_kyc', false), entry(2, 'sumsub_kyc', false)]),
      ),
    );
    expect(notes).toEqual([]);
  });

  it('groups the versions that run the same selected id', () => {
    const notes = describePublishConnectorNotes(
      definition(
        step('submit_kyc', [
          entry(1, 'sumsub_kyc', true),
          entry(2, 'sumsub_kyc', true),
          entry(3, 'veriff_kyc', false),
        ]),
      ),
    );
    expect(notes).toEqual([
      'Step `submit_kyc` runs sumsub_kyc on v1, v2 (selected). v3 will run its authored veriff_kyc.',
    ]);
  });

  it('gives one note per step', () => {
    const notes = describePublishConnectorNotes(
      definition(
        step('submit_kyc', [entry(1, 'sumsub_kyc', true)]),
        step('send_mail', [entry(2, 'sumsub_kyc', true)]),
      ),
    );
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('Step `send_mail` runs sumsub_kyc on v2');
  });

  it("ignores the draft's own entry", () => {
    const notes = describePublishConnectorNotes(
      definition(step('submit_kyc', [entry(3, 'sumsub_kyc', true)])),
    );
    expect(notes).toEqual([]);
  });
});
