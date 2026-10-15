import { describe, expect, it } from 'vitest';
import type { WorkflowVersion } from '@/api/workflows/workflow-versions';
import { defaultForkVersion, nextWorkflowVersion } from './workflow-version-picks';

function version(number: number, status: WorkflowVersion['status']): WorkflowVersion {
  return { version: number, status, createdAt: '2026-07-01', updatedAt: '2026-07-02' };
}

describe('nextWorkflowVersion', () => {
  it('is one past the highest version of any status', () => {
    expect(
      nextWorkflowVersion([version(2, 'retired'), version(5, 'draft'), version(3, 'published')]),
    ).toBe(6);
  });

  it('is 1 for an empty list', () => {
    expect(nextWorkflowVersion([])).toBe(1);
  });
});

describe('defaultForkVersion', () => {
  it('picks the latest published version over a newer retired one', () => {
    expect(
      defaultForkVersion([
        version(4, 'retired'),
        version(3, 'published'),
        version(2, 'published'),
        version(5, 'draft'),
      ]),
    ).toBe(3);
  });

  it('falls back to the latest retired version when none is published', () => {
    expect(
      defaultForkVersion([version(1, 'retired'), version(2, 'retired'), version(3, 'draft')]),
    ).toBe(2);
  });

  it('is null when there is only a draft or nothing', () => {
    expect(defaultForkVersion([version(1, 'draft')])).toBeNull();
    expect(defaultForkVersion([])).toBeNull();
  });
});
