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
        action="onboarding.state_transition"
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

  it('joins the pairs inline with a middot, in the design’s `key: value` form', () => {
    const { container } = render(
      <AuditMetadata
        action="onboarding.state_transition"
        metadata={{ fromStep: 'submit_kyc', toStep: 'manual_review' }}
      />,
    );

    expect(container.textContent).toBe('fromStep: submit_kyc · toStep: manual_review');
  });

  it('joins a list value so roles read as a sentence rather than as JSON', () => {
    render(
      <AuditMetadata
        action="onboarding.state_transition"
        metadata={{ grantedRoles: ['admin', 'auditor'] }}
      />,
    );

    expect(screen.getByText('admin, auditor')).toBeInTheDocument();
  });

  it('renders non-string primitives as text', () => {
    render(
      <AuditMetadata
        action="onboarding.state_transition"
        metadata={{ workflowVersion: 3, suppressed: false }}
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('marks an absent value rather than printing null', () => {
    render(
      <AuditMetadata
        action="onboarding.state_transition"
        metadata={{ fromStatus: null, requiredRoles: [] }}
      />,
    );

    expect(screen.getAllByText('-')).toHaveLength(2);
  });

  it('keeps a nested object as JSON so its keys cannot be mistaken for top-level ones', () => {
    render(
      <AuditMetadata
        action="onboarding.state_transition"
        metadata={{ response: { status: 204 } }}
      />,
    );

    expect(screen.getByText('{"status":204}')).toBeInTheDocument();
  });

  it('falls back to the not-set placeholder when the event carries no metadata', () => {
    render(<AuditMetadata action="onboarding.state_transition" metadata={{}} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
  });

  it('appends the redaction note for a connector_settings action', () => {
    render(
      <AuditMetadata
        action="connector_settings.updated"
        metadata={{ keys: ['appToken', 'secretKey'] }}
      />,
    );

    expect(screen.getByText('(values never logged)')).toBeInTheDocument();
  });

  it('does not append the redaction note for an unrelated action', () => {
    render(<AuditMetadata action="onboarding.started" metadata={{ workflowId: 'wf_1' }} />);

    expect(screen.queryByText('(values never logged)')).not.toBeInTheDocument();
  });
});
