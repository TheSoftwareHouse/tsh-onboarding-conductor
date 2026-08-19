import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditMetadata } from './AuditMetadata';

afterEach(() => {
  cleanup();
});

describe('AuditMetadata', () => {
  it('labels every key the engine recorded, in the order it returned them', () => {
    render(
      <AuditMetadata
        metadata={{ method: 'GET', userPrincipalName: 'operator@tsh.io', grantedRoles: ['admin'] }}
      />,
    );

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'method',
      'userPrincipalName',
      'grantedRoles',
    ]);
    expect(screen.getByText('operator@tsh.io')).toBeInTheDocument();
  });

  it('emits the pairs as direct children, which is what lets one grid align every key', () => {
    const { container } = render(
      <AuditMetadata metadata={{ method: 'GET', userPrincipalName: 'operator@tsh.io' }} />,
    );

    const list = container.querySelector('.metadata-list');
    expect(Array.from(list?.children ?? []).map((child) => child.tagName)).toEqual([
      'DT',
      'DD',
      'DT',
      'DD',
    ]);
  });

  it('joins a list value so roles read as a sentence rather than as JSON', () => {
    render(<AuditMetadata metadata={{ grantedRoles: ['admin', 'auditor'] }} />);

    expect(screen.getByText('admin, auditor')).toBeInTheDocument();
  });

  it('renders non-string primitives as text', () => {
    render(<AuditMetadata metadata={{ workflowVersion: 3, suppressed: false }} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('marks an absent value rather than printing null', () => {
    render(<AuditMetadata metadata={{ fromStatus: null, requiredRoles: [] }} />);

    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  it('keeps a nested object as JSON so its keys cannot be mistaken for top-level ones', () => {
    render(<AuditMetadata metadata={{ response: { status: 204 } }} />);

    expect(screen.getByText('{"status":204}')).toBeInTheDocument();
  });

  it('falls back to the not-set placeholder when the event carries no metadata', () => {
    render(<AuditMetadata metadata={{}} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });
});
