import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';

/** One sentence per step whose other versions run a selected connector the draft would not. */
export function describePublishConnectorNotes(definition: WorkflowDefinition): string[] {
  const notes: string[] = [];

  for (const step of definition.steps) {
    for (const connector of step.connectors) {
      const idsToVersions = new Map<string, number[]>();
      for (const entry of connector.versions) {
        if (entry.version === definition.workflowVersion) {
          continue;
        }
        if (entry.selected && entry.id !== connector.authoredId) {
          idsToVersions.set(entry.id, [...(idsToVersions.get(entry.id) ?? []), entry.version]);
        }
      }
      for (const [id, versions] of idsToVersions) {
        const list = versions.map((version) => `v${version}`).join(', ');
        notes.push(
          `Step \`${step.name}\` runs ${id} on ${list} (selected). v${definition.workflowVersion} will run its authored ${connector.authoredId}.`,
        );
      }
    }
  }

  return notes;
}
