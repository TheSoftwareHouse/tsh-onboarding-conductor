import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditActorCell } from './AuditActorCell';

afterEach(() => {
  cleanup();
});

describe('AuditActorCell', () => {
  it('distinguishes the operator chip from the system chip by class', () => {
    render(<AuditActorCell actorType="operator" actorId="9f3c0000-0000-0000-0000-00000000000a" />);

    expect(screen.getByText('Operator')).toHaveClass('bg-tsh-purple-300');

    cleanup();

    render(<AuditActorCell actorType="system" actorId="engine" />);

    expect(screen.getByText('System')).toHaveClass('bg-bg-alt');
  });

  it('renders the actor id as a second line', () => {
    render(<AuditActorCell actorType="operator" actorId="9f3c0000-0000-0000-0000-00000000000a" />);

    expect(screen.getByText('9f3c0000-0000-0000-0000-00000000000a')).toBeInTheDocument();
  });

  it('tones an anonymous actor the same as system, both neutral', () => {
    render(<AuditActorCell actorType="anonymous" actorId="unknown" />);

    expect(screen.getByText('Anonymous')).toHaveClass('bg-bg-alt');
  });

  it('omits the placeholder id the engine writes for system and anonymous actors', () => {
    render(<AuditActorCell actorType="system" actorId="engine" />);

    expect(screen.queryByText('engine')).not.toBeInTheDocument();

    cleanup();

    render(<AuditActorCell actorType="anonymous" actorId="unknown" />);

    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('keeps the id of an actor type it does not recognize, which may identify someone', () => {
    render(<AuditActorCell actorType="scheduler" actorId="nightly-sweep" />);

    expect(screen.getByText('nightly-sweep')).toBeInTheDocument();
  });
});
