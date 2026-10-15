import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowView } from '../../utils/workflow-details-search-params';
import { VersionTabs } from './VersionTabs';

afterEach(cleanup);

function renderTabs(value: WorkflowView, keepJsonMounted = false) {
  const onValueChange = vi.fn();
  render(
    <VersionTabs
      value={value}
      onValueChange={onValueChange}
      graph={<p>graph panel</p>}
      json={<p>json panel</p>}
      keepJsonMounted={keepJsonMounted}
    />,
  );
  return onValueChange;
}

describe('VersionTabs', () => {
  it('renders a Graph and a JSON tab', () => {
    renderTabs('graph');
    expect(screen.getByRole('tab', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'JSON' })).toBeInTheDocument();
  });

  it('shows the selected tab panel only', () => {
    renderTabs('graph');
    expect(screen.getByText('graph panel')).toBeInTheDocument();
    expect(screen.queryByText('json panel')).not.toBeInTheDocument();
  });

  it('calls onValueChange with the other value on click', async () => {
    const onValueChange = renderTabs('graph');
    await userEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(onValueChange).toHaveBeenCalledWith('json');
  });

  it('keeps the JSON panel in the DOM while Graph is selected when keepJsonMounted is set', () => {
    renderTabs('graph', true);
    expect(screen.getByText('json panel', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('graph panel')).toBeVisible();
  });
});
