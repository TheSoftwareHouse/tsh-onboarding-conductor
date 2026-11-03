import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, invalidPayloadError } from '@/services/api/api-error';
import { LoadFailure } from './LoadFailure';

afterEach(() => {
  cleanup();
});

const failure = (status: number): ApiError => new ApiError('Engine said no.', { status });

describe('LoadFailure', () => {
  it('renders 403 as denied without a retry', () => {
    render(<LoadFailure error={failure(403)} subject="audit events" onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('No access to audit events');
    expect(screen.getByText('Engine said no.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('uses deniedSubject for the 403 title', () => {
    render(
      <LoadFailure error={failure(403)} subject="audit events" deniedSubject="the audit log" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No access to the audit log');
  });

  it('renders 404 with notFound as notFound with its actions', () => {
    render(
      <LoadFailure
        error={failure(404)}
        subject="workflow"
        notFound={{
          title: 'Workflow not found',
          body: 'No such workflow.',
          actions: <button type="button">Back</button>,
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Workflow not found');
    expect(screen.getByText('No such workflow.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('falls back to error for 404 without notFound', () => {
    render(<LoadFailure error={failure(404)} subject="workflow" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load workflow');
  });

  it.each([
    ['401', failure(401)],
    ['500', failure(500)],
    ['invalid-payload', invalidPayloadError('Bad payload.')],
  ])('renders %s as error with its message', (_name, error) => {
    render(<LoadFailure error={error} subject="onboardings" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load onboardings');
    expect(screen.getByText(error.message)).toBeInTheDocument();
  });

  it('renders null as error with the fallback body', () => {
    render(<LoadFailure error={null} subject="onboardings" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load onboardings');
    expect(screen.getByText('Request failed.')).toBeInTheDocument();
  });

  it('calls onRetry from the Retry button', async () => {
    const onRetry = vi.fn();
    render(<LoadFailure error={failure(500)} subject="onboardings" onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith();
  });

  it('renders no Retry without onRetry', () => {
    render(<LoadFailure error={failure(500)} subject="onboardings" />);

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('appends bodySuffix to the error body', () => {
    render(
      <LoadFailure error={failure(500)} subject="activity" bodySuffix=" The rest is up to date." />,
    );

    expect(screen.getByText('Engine said no. The rest is up to date.')).toBeInTheDocument();
  });

  it('renders in the section layout', () => {
    render(
      <LoadFailure error={failure(500)} subject="activity" layout="section" onRetry={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Unable to load activity');
  });
});
