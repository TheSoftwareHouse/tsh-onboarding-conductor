import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthoredDocument } from '../../utils/authored-document';
import { projectDocument } from '../../utils/authored-projection';
import { CanvasStatus } from './CanvasStatus';

afterEach(cleanup);

const LONG_ISSUE =
  'invalid config: request.url must be a string, request.method must be one of GET, POST, PUT, PATCH, DELETE';

const DOC: AuthoredDocument = {
  initial: 'check',
  steps: [
    {
      name: 'check',
      type: 'decision',
      config: { branches: [{ port: 'yes', when: { field: 'x', isSet: true } }], fallback: true },
      edges: { yes: 'done', default: 'done' },
    },
    { name: 'done', type: 'terminal', config: { outcome: 'approved' } },
    { name: 'orphan', type: 'decision', config: { branches: 'nope' }, edges: { yes: 'ghost' } },
  ],
};

describe('CanvasStatus', () => {
  it('lists every issue of a problem step in full, one per line', () => {
    render(
      <CanvasStatus
        steps={projectDocument(DOC).steps}
        edgeCount={0}
        workflowIssues={[]}
        failure={null}
        onOpenSettings={vi.fn()}
        onFocusStep={vi.fn()}
      />,
    );

    const entry = screen.getByRole('button', { name: /^orphan:/ });
    expect(entry).toHaveTextContent('unreachable from the initial step');
    expect(entry).toHaveTextContent('invalid config: branches (Must be a list)');
    expect(entry).toHaveTextContent('points to missing ghost');
    expect(entry).not.toHaveTextContent('(+');
    expect(entry).not.toHaveAttribute('title');
    expect(screen.queryByRole('button', { name: /^done:/ })).not.toBeInTheDocument();
  });

  it('shows a long issue untruncated', () => {
    const [step] = projectDocument(DOC).steps.filter((candidate) => candidate.issues.length > 0);
    render(
      <CanvasStatus
        steps={[{ ...step!, issues: [LONG_ISSUE] }]}
        edgeCount={0}
        workflowIssues={[]}
        failure={null}
        onOpenSettings={vi.fn()}
        onFocusStep={vi.fn()}
      />,
    );

    const line = screen.getByText(LONG_ISSUE);
    expect(line).toBeInTheDocument();
    expect(line.closest('button')).not.toHaveClass('truncate');
  });

  it('focuses the step when its entry is clicked', async () => {
    const onFocusStep = vi.fn();
    render(
      <CanvasStatus
        steps={projectDocument(DOC).steps}
        edgeCount={0}
        workflowIssues={[]}
        failure={null}
        onOpenSettings={vi.fn()}
        onFocusStep={onFocusStep}
      />,
    );

    await userEvent.click(screen.getByText('points to missing ghost'));

    expect(onFocusStep).toHaveBeenCalledWith('orphan');
  });

  it('lists the problems of the workflow itself and opens Workflow settings from them', async () => {
    const onOpenSettings = vi.fn();
    const { steps, workflowIssues } = projectDocument({
      ...DOC,
      agreements: [{ key: 'terms', step: 'gone', acceptedWhen: 'accepted' }],
    });
    render(
      <CanvasStatus
        steps={steps}
        edgeCount={0}
        workflowIssues={workflowIssues}
        failure={null}
        onFocusStep={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByText('⚠ workflow and 1 step with problems')).toBeInTheDocument();
    await userEvent.click(screen.getByText('agreement terms points to missing gone'));

    expect(onOpenSettings).toHaveBeenCalled();
  });
});
