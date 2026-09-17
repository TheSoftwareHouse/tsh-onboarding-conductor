import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEventFilters } from '../../utils/filter-audit-events';
import { AuditResourceTabs } from './AuditResourceTabs';

const baseFilters: AuditEventFilters = {
  actorType: '',
  actorId: 'op-1',
  action: '',
  resourceType: '',
  resourceId: '',
  occurredPeriod: '',
  occurredFrom: '',
  occurredTo: '',
  limit: 100,
};

function renderTabs(filters: AuditEventFilters, total: number): void {
  render(
    <MemoryRouter>
      <AuditResourceTabs filters={filters} total={total} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('AuditResourceTabs', () => {
  it('names the tab strip "Resource type"', () => {
    renderTabs(baseFilters, 128);

    expect(screen.getByRole('navigation', { name: 'Resource type' })).toBeInTheDocument();
  });

  it('marks All active with no resourceType parameter, keeping other committed criteria', () => {
    renderTabs(baseFilters, 128);

    const all = screen.getByRole('link', { name: 'All 128' });
    expect(all).toHaveAttribute('aria-current', 'page');
    expect(all).toHaveAttribute('href', '/audit?actorId=op-1');

    expect(screen.getByRole('link', { name: 'Onboardings' })).not.toHaveAttribute('aria-current');
  });

  it("sets a resource tab's href to that resource type, resets the page, and keeps other committed criteria", () => {
    renderTabs(baseFilters, 128);

    const onboardings = screen.getByRole('link', { name: 'Onboardings' });
    expect(onboardings).toHaveAttribute('href', '/audit?actorId=op-1&resourceType=onboarding');
  });

  it('shows a count only on the active tab', () => {
    renderTabs({ ...baseFilters, resourceType: 'onboarding' }, 68);

    expect(screen.getByRole('link', { name: 'Onboardings 68' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'All' })).toHaveTextContent(/^All$/);
    expect(screen.getByRole('link', { name: 'Webhook outbox' })).toHaveTextContent(
      /^Webhook outbox$/,
    );
  });
});
